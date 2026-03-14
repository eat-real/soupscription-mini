import { useState, useRef, useCallback, useEffect } from "react";

/* ══════════════════════════════════════════════════════
   TELEGRAM WEB APP
══════════════════════════════════════════════════════ */
const tg = window.Telegram?.WebApp;
const TG_USER = tg?.initDataUnsafe?.user;

/* ══════════════════════════════════════════════════════
   GOOGLE SHEETS
══════════════════════════════════════════════════════ */
const SHEETS_ID  = import.meta.env.VITE_SHEETS_ID;
const SHEETS_KEY = import.meta.env.VITE_SHEETS_API_KEY;
const BOT_TOKEN  = import.meta.env.VITE_BOT_TOKEN;
const ADMIN_ID   = import.meta.env.VITE_ADMIN_CHAT_ID;

async function fetchMenu() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values/menu!A:P?key=${SHEETS_KEY}`;
  const r = await fetch(url);
  const data = await r.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  // Ищем строку с заголовками (где есть "id")
  const headerRowIdx = rows.findIndex(row => row[0] === "id");
  if (headerRowIdx === -1) return [];

  const headers = rows[headerRowIdx].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(headerRowIdx + 1);

  return dataRows.map(row => {
    while (row.length < headers.length) row.push("");
    const d = Object.fromEntries(headers.map((h, i) => [h, row[i]]));

    // Поддержка разных названий колонок
    const name = d["name_en"] || d["name"] || d["name_ru"] || "";
    const price = parseFloat(d["price €"] || d["price"] || 0);
    const p = parseInt(d["protein g"] || d["p"] || 0);
    const f = parseInt(d["fat g"] || d["f"] || 0);
    const c = parseInt(d["carbs g"] || d["c"] || 0);
    const cat = d["category"] || d["cat"] || "";
    const active = d["active"]?.toString().toUpperCase();

    if (active === "FALSE" || active === "0") return null;

    return {
      id:       String(d.id || ""),
      name,
      cat,
      kcal:     parseInt(d.kcal || 0),
      p, f, c, price,
      fresh:    d.fresh === "1" || d.fresh === "TRUE",
      portions: parseInt(d.portions || 0),
      desc:     d["desc_ru"] || d["desc_en"] || d["desc"] || d["description"] || "",
      sides:    (d["sides"] || "").split(",").map(s => s.trim()).filter(Boolean),
        img_url: (() => {
          const k = Object.keys(d).find(k => k.toLowerCase() === "img" || k.toLowerCase().includes("img"));
          const raw = k ? (d[k] || "") : "";
          if (!raw) return "";
          if (raw.startsWith("photo-")) return `https://images.unsplash.com/${raw}?w=400&h=260&fit=crop`;
          if (raw.startsWith("http")) return raw;
          return "";
        })(),
    };
  }).filter(d => d && d.portions > 0 && d.name);
}

async function sendToBot(text) {
  if (!BOT_TOKEN || !ADMIN_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: "Markdown" }),
  });
}

/* ══════════════════════════════════════════════════════
   КОНСТАНТЫ
══════════════════════════════════════════════════════ */
const DELIVERY_FEE   = 5;
const FREE_THRESHOLD = 50;
const DELIVERY_DAYS  = new Set([1, 3, 5]);
const DAY_NAMES_EN   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_NAMES_RU   = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
const SLOTS = [
  { key: "breakfast", label: "☀️ Breakfast", labelRu: "☀️ Завтрак" },
  { key: "lunch",     label: "🌤 Lunch",     labelRu: "🌤 Обед"    },
  { key: "dinner",    label: "🌙 Dinner",    labelRu: "🌙 Ужин"    },
];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CATS = [
  { key: "breakfast", icon: "☀️", label: "Breakfast" },
  { key: "soup",      icon: "🍲", label: "Soups"     },
  { key: "main",      icon: "🍖", label: "Mains"     },
  { key: "special",   icon: "⭐", label: "Specials"  },
  { key: "side",      icon: "🍚", label: "Sides"     },
];

function slotBlock(dow, slotKey) {
  if (slotKey === "breakfast") {
    if (dow === 3) return 0; // Wed breakfast → Mon block
    if (dow === 5) return 1; // Fri breakfast → Wed block
    if (dow === 0) return 2; // Sun breakfast → Fri block
  }
  return dayToBlock(dow);
}

function dayToBlock(dow) {
  if (dow === 1 || dow === 2) return 0;
  if (dow === 3 || dow === 4) return 1;
  return 2;
}

function buildWeek() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() + 1);
  while (!DELIVERY_DAYS.has(start.getDay())) start.setDate(start.getDate() + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    const isDelivery = DELIVERY_DAYS.has(dow);
    const blocked = new Set();
    if (dow === 1) blocked.add("breakfast");
    if (dow === 0) { blocked.add("lunch"); blocked.add("dinner"); }
    return {
      key: `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`,
      name: DAY_NAMES_EN[dow],
      num: d.getDate(),
      mon: MON[d.getMonth()],
      dow,
      isDelivery,
      freshOk: isDelivery,
      block: dayToBlock(dow),
      blocked,
    };
  });
}

/* ══════════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#f5f2ed;--surf:#fff;--surf2:#eeebe5;--surf3:#e5e1da;
    --ink:#1c1a17;--ink2:#6b6459;--ink3:#a89f94;
    --g:#2a5c24;--gm:#3d7a35;--gl:#5a9e50;--gp:#e8f2e7;--gxp:#f2f8f1;
    --a:#b5711f;--al:#d4903a;--ap:#fdf0e0;
    --rose:#b84c3c;--rose-p:#fdf2f1;
    --bd:#e0dbd4;--bd2:#cbc5bd;--r:12px;
  }
  html,body,#root{height:100%;background:var(--tg-theme-bg-color,var(--bg))}
  body{font-family:'DM Sans',sans-serif;color:var(--ink);overflow-x:hidden}
  h1,h2,h3{font-family:'Playfair Display',serif}
  button{font-family:'DM Sans',sans-serif;cursor:pointer}
  ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-thumb{background:var(--bd2);border-radius:10px}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes pop{0%{transform:scale(.9)}60%{transform:scale(1.05)}100%{transform:scale(1)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .fu{animation:fadeUp .3s ease both}

  /* ── Header ── */
  .hdr{position:sticky;top:0;z-index:100;background:linear-gradient(160deg,#192b16,#2a5c24);
    padding:12px 14px 10px;display:flex;align-items:center;justify-content:space-between}
  .hdr-logo{font-family:'Playfair Display',serif;font-size:18px;color:white;font-style:italic}
  .hdr-sub{font-size:10px;color:rgba(255,255,255,.55);margin-top:1px}

  /* ── Bottom bar ── */
  .bbar{position:fixed;bottom:0;left:0;right:0;background:var(--surf);
    border-top:1px solid var(--bd);display:flex;z-index:100;
    padding-bottom:env(safe-area-inset-bottom,0)}
  .bbar-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:2px;padding:8px 4px;border:none;background:transparent;font-size:10px;
    color:var(--ink3);font-weight:500;transition:color .12s}
  .bbar-btn.on{color:var(--g);font-weight:700}
  .bbar-icon{font-size:20px;line-height:1}

  /* ── Pages ── */
  .page{padding:12px 14px 90px}

  /* ── Menu cards ── */
  .mc{background:var(--surf);border-radius:var(--r);border:1.5px solid var(--bd);
    overflow:hidden;transition:all .15s;margin-bottom:10px}
  .mc-img{width:100%;height:130px;object-fit:cover;display:block}
  .mc-body{padding:10px 12px 12px}
  .mc-name{font-size:14px;font-weight:600;margin-bottom:4px}
  .mc-desc{font-size:11px;color:var(--ink2);margin-bottom:8px;line-height:1.5}
  .mc-kbju{display:grid;grid-template-columns:repeat(4,1fr);background:var(--surf2);
    border-radius:8px;padding:5px;margin-bottom:8px}
  .mc-kbju-cell{text-align:center}
  .mc-kbju-val{font-size:11px;font-weight:700}
  .mc-kbju-lbl{font-size:8px;color:var(--ink3)}
  .mc-footer{display:flex;justify-content:space-between;align-items:center}
  .mc-price{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:var(--g)}
  .mc-portions{font-size:10px;color:var(--ink3)}

  /* ── Planner ── */
  .day-strip{display:flex;gap:6px;overflow-x:auto;padding:0 14px 10px;
    margin:0 -14px;scrollbar-width:none}
  .day-strip::-webkit-scrollbar{display:none}
  .dpill{flex-shrink:0;border-radius:20px;padding:6px 12px;border:1.5px solid var(--bd);
    background:var(--surf);text-align:center;min-width:52px;transition:all .13s}
  .dpill.on{background:linear-gradient(160deg,#192b16,#2a5c24);border-color:transparent;color:white}
  .dpill.del{border-color:var(--gm)}
  .dpill.has{background:var(--gxp);border-color:var(--gm)}
  .slot-card{border-radius:var(--r);border:1.5px solid var(--bd);background:var(--surf);
    overflow:hidden;display:flex;align-items:stretch;min-height:64px;margin-bottom:8px;
    transition:all .13s}
  .slot-card.avl{border-color:var(--gm);background:var(--gxp)}
  .slot-card.fld{border-color:#bddcbc;background:var(--gxp)}
  .slot-card.blk{border-color:#e8cdc8;opacity:.5}
  .slot-icon{width:44px;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:2px;background:var(--surf2);flex-shrink:0;font-size:16px}
  .slot-icon-lbl{font-size:8px;font-weight:600;color:var(--ink3)}
  .slot-content{flex:1;display:flex;align-items:center;padding:8px 10px;gap:8px}

  /* ── Dish picker ── */
  .picker{background:var(--surf);border-radius:var(--r);border:1px solid var(--bd);
    overflow:hidden;margin-bottom:10px}
  .picker-tabs{display:flex;border-bottom:1px solid var(--bd);overflow-x:auto}
  .picker-tab{flex:1;min-width:60px;padding:9px 4px;border:none;background:transparent;
    font-size:10px;font-weight:500;color:var(--ink3);border-bottom:2px solid transparent;
    white-space:nowrap;transition:all .12s}
  .picker-tab.on{color:var(--g);font-weight:700;border-bottom-color:var(--gm);background:var(--gxp)}
  .dish-row{display:flex;gap:8px;overflow-x:auto;padding:10px;scrollbar-width:none}
  .dish-row::-webkit-scrollbar{display:none}
  .dish-card{flex-shrink:0;width:120px;border-radius:10px;border:1.5px solid var(--bd);
    background:var(--surf);overflow:hidden;transition:all .13s}
  .dish-card.sel{border-color:var(--gm);box-shadow:0 0 0 3px rgba(61,122,53,.2)}
  .dish-card-img{height:70px;width:100%;object-fit:cover;display:block;background:var(--surf2)}
  .dish-card-body{padding:5px 6px 7px}
  .dish-card-name{font-size:10px;font-weight:600;line-height:1.3;margin-bottom:3px}
  .dish-card-info{display:flex;justify-content:space-between;font-size:9px}

  /* ── Summary ── */
  .sum-day{background:var(--surf);border-radius:var(--r);border:1px solid var(--bd);
    padding:12px;margin-bottom:10px}
  .sum-day-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .sum-day-name{font-weight:700;font-size:14px}
  .sum-day-kcal{font-size:11px;color:var(--ink2)}
  .sum-slot{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;
    border-bottom:1px solid var(--surf2)}
  .sum-slot:last-child{border-bottom:none}
  .del-block{border-radius:var(--r);padding:10px 12px;margin-bottom:8px;
    display:flex;justify-content:space-between;align-items:center}
  .del-block.free{background:var(--gxp);border:1px solid var(--gm)}
  .del-block.paid{background:var(--ap);border:1px solid #e8d8b8}

  /* ── Buttons ── */
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;
    border:none;border-radius:var(--r);font-weight:600;transition:all .14s;white-space:nowrap}
  .btn-g{background:var(--g);color:#fff;padding:12px 20px;font-size:14px;width:100%}
  .btn-g:active{transform:scale(.97)}
  .btn-a{background:var(--a);color:#fff;padding:10px 16px;font-size:13px}
  .btn-out{background:transparent;color:var(--ink);border:1.5px solid var(--bd2);
    padding:8px 14px;font-size:12px}
  .spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.3);
    border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
`;

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
const IMG = (url, alt) => (
  <img src={url} alt={alt} className="mc-img"
    onError={e => { e.target.style.display = "none"; }} />
);

function calcDelivery(plan, week) {
  const dowMap = Object.fromEntries(week.map(d => [d.key, d.dow]));
  const bt = { 0: 0, 1: 0, 2: 0 };
  for (const [date, slots] of Object.entries(plan)) {
    const dow = dowMap[date] ?? 0;
    for (const [sk, v] of Object.entries(slots)) {
      if (sk === "extras") {
        (v || []).forEach(e => { bt[dayToBlock(dow)] += (e?.dish?.price||0) + (e?.side?.price||0); });
      } else if (v) {
        bt[slotBlock(dow, sk)] += (v?.dish?.price||0) + (v?.side?.price||0);
      }
    }
  }
  const fee = Object.values(bt).reduce((s, v) => s + (v > 0 && v < FREE_THRESHOLD ? DELIVERY_FEE : 0), 0);
  return { fee, bt };
}

function formatSummary(plan, week, userName) {
  let foodTotal = 0;
  const lines = [`🥣 *SoupScription*\n👤 ${userName}\n`];
  for (const day of week) {
    const dp = plan[day.key] || {};
    const filled = Object.entries(dp).filter(([k, v]) => k === "extras" ? v?.length > 0 : !!v);
    if (!filled.length) continue;
    const allE = filled.flatMap(([k, v]) => k === "extras" ? (v||[]) : [v]);
    const kcal  = allE.reduce((s,e)=>s+(e?.dish?.kcal||0)+(e?.side?.kcal||0),0);
    const price = allE.reduce((s,e)=>s+(e?.dish?.price||0)+(e?.side?.price||0),0);
    foodTotal += price;
    const icon = day.isDelivery ? "🚚" : "📅";
    lines.push(`${icon} *${day.name} ${day.num}*`);
    for (const [sk, v] of filled) {
      if (sk === "extras") {
        (v||[]).forEach(e => {
          const sidePart = e.side ? ` + ${e.side.name}` : "";
          lines.push(`  ★ Extra: ${e.dish?.name}${sidePart} — ${((e.dish?.price||0)+(e.side?.price||0)).toFixed(2)}€`);
        });
      } else {
        const slot = SLOTS.find(s => s.key === sk);
        const sidePart = v.side ? ` + ${v.side.name}` : "";
        lines.push(`  ${slot?.label}: ${v.dish?.name}${sidePart} — ${((v.dish?.price||0)+(v.side?.price||0)).toFixed(2)}€`);
      }
    }
    lines.push(`  ┄ ${kcal} kcal · ${price.toFixed(2)}€\n`);
  }
  const { fee, bt } = calcDelivery(plan, week);
  const BNAMES = ["Mon delivery block", "Wed delivery block", "Fri delivery block"];
  for (const [bi, bv] of Object.entries(bt)) {
    if (bv > 0) lines.push(bv >= FREE_THRESHOLD ? `🚚 ${BNAMES[bi]}: free ✅` : `🚚 ${BNAMES[bi]}: +${DELIVERY_FEE}€`);
  }
  lines.push(`\n💰 *Total: ${(foodTotal + fee).toFixed(2)}€*`);
  return { text: lines.join("\n"), total: foodTotal + fee };
}

/* ══════════════════════════════════════════════════════
   COMPONENTS
══════════════════════════════════════════════════════ */
function MenuPage({ menu, loading }) {
  const [cat, setCat] = useState("breakfast");
  const items = menu.filter(d => d.cat === cat);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
      <div className="spinner" style={{ borderColor: "var(--bd)", borderTopColor: "var(--g)" }} />
    </div>
  );

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "Playfair Display,serif", fontSize: 22, marginBottom: 3 }}>Menu</div>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>Updated weekly · Natural ingredients</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
        {CATS.map(c => (
          <button key={c.key} onClick={() => setCat(c.key)} style={{
            flexShrink: 0, padding: "6px 13px", borderRadius: 20, border: "1.5px solid",
            borderColor: cat === c.key ? "var(--gm)" : "var(--bd)",
            background: cat === c.key ? "var(--gxp)" : "var(--surf)",
            color: cat === c.key ? "var(--g)" : "var(--ink2)",
            fontSize: 12, fontWeight: cat === c.key ? 700 : 400,
          }}>{c.icon} {c.label}</button>
        ))}
      </div>
      {items.map((d, i) => (
        <div key={d.id} className="mc fu" style={{ animationDelay: `${i * .05}s` }}>
          <div style={{ height: 160, overflow: "hidden", position: "relative", background: "var(--surf2)" }}>
            {d.img_url && <img src={d.img_url} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={e => e.target.style.display = "none"} />}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom,transparent 50%,rgba(0,0,0,.45))" }} />
            {d.fresh && <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(181,113,31,.9)", color: "white", fontSize: 9, fontWeight: 700, borderRadius: 20, padding: "2px 8px" }}>⚡ fresh</div>}
            <div style={{ position: "absolute", bottom: 8, right: 10, fontFamily: "Playfair Display,serif", fontSize: 18, fontWeight: 700, color: "white" }}>{d.price}€</div>
          </div>
          <div className="mc-body">
            <div className="mc-name">{d.name}</div>
            {d.desc && <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 8, lineHeight: 1.5 }}>{d.desc}</div>}
            <div className="mc-kbju">
              {[["Kcal", d.kcal, "var(--a)"], ["P", `${d.p}g`, "#3b82f6"], ["F", `${d.f}g`, "var(--a)"], ["C", `${d.c}g`, "var(--gm)"]].map(([l, v, c]) => (
                <div key={l} className="mc-kbju-cell">
                  <div className="mc-kbju-val" style={{ color: c }}>{v}</div>
                  <div className="mc-kbju-lbl">{l}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "Playfair Display,serif", fontSize: 20, fontWeight: 700, color: "var(--g)" }}>{d.price}€</span>
              <span style={{ fontSize: 10, color: d.portions > 5 ? "var(--g)" : d.portions > 0 ? "var(--a)" : "var(--rose)", fontWeight: 600 }}>{d.portions} left</span>
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && <div style={{ textAlign: "center", color: "var(--ink3)", padding: 30 }}>No dishes this week</div>}
    </div>
  );
}

function SidePickerModal({ dish, sides, onSelect, onSkip }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 200, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "var(--surf)", borderRadius: "18px 18px 0 0", padding: "20px 16px 32px", width: "100%" }} className="fu">
        <div style={{ fontFamily: "Playfair Display,serif", fontSize: 18, marginBottom: 2 }}>🍚 Choose a side</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 14 }}>for {dish.name}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {sides.map(side => (
            <button key={side.id} onClick={() => onSelect(side)} style={{
              padding: "10px 14px", borderRadius: 12, border: "1.5px solid var(--bd)",
              background: "var(--surf)", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
            }}>
              {side.img_url && <img src={side.img_url} alt={side.name} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} onError={e => e.target.style.display="none"} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{side.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                  {side.kcal} kcal · P{side.p}g · F{side.f}g · C{side.c}g
                </div>
              </div>
              <div style={{ fontFamily: "Playfair Display,serif", fontSize: 15, fontWeight: 700, color: "var(--g)", flexShrink: 0 }}>{side.price}€</div>
            </button>
          ))}
        </div>
        <button className="btn btn-out" style={{ width: "100%", justifyContent: "center" }} onClick={onSkip}>
          No side dish →
        </button>
      </div>
    </div>
  );
}

function AutoFillModal({ menu, week, onFill, onClose }) {
  const [kcal, setKcal] = useState(null);
  const [days, setDays] = useState(null);

  const goals = [
    { label: "👩 Weight loss", sub: "~1400 kcal/day", val: 1400 },
    { label: "🧘 Maintain",    sub: "~2000 kcal/day", val: 2000 },
    { label: "💪 Muscle gain", sub: "~2500 kcal/day", val: 2500 },
  ];
  const dayOpts = [
    { label: "5 days", sub: "Mon–Fri", val: 5 },
    { label: "7 days", sub: "Mon–Sun", val: 7 },
  ];

  const handleFill = () => {
    if (!kcal || !days) return;
    const breakfasts = menu.filter(d => d.cat === "breakfast" && !d.fresh);
    const soups      = menu.filter(d => d.cat === "soup" && !d.fresh);
    const mains      = menu.filter(d => d.cat === "main" && !d.fresh);
    const extras     = menu.filter(d => !d.fresh); // любые блюда для добора
    const shuffle    = arr => [...arr].sort(() => Math.random() - .5);
    const sb = shuffle(breakfasts), ss = shuffle(soups), sm = shuffle(mains), se = shuffle(extras);
    const newPlan = {};
    let count = 0;
    for (const day of week) {
      if (count >= days) break;
      if (day.dow === 6) continue;
      if (day.blocked.has("lunch") && day.blocked.has("dinner")) continue;
      const dp = {};
      if (!day.blocked.has("breakfast") && sb.length) dp.breakfast = sb[count % sb.length];
      if (ss.length) dp.lunch = ss[count % ss.length];
      if (sm.length) dp.dinner = sm[count % sm.length];

      // Добираем калории через extras пока не достигнем цели ±200
      const dayKcal = () => {
        let k = 0;
        if (dp.breakfast) k += dp.breakfast.kcal;
        if (dp.lunch)     k += dp.lunch.kcal;
        if (dp.dinner)    k += dp.dinner.kcal;
        (dp.extras || []).forEach(e => k += e.kcal);
        return k;
      };

      if (kcal > 1600 && se.length) { // для maintain и gain
        let attempts = 0;
        while (dayKcal() < kcal - 200 && attempts < 5) {
          const candidate = se[attempts % se.length];
          // Не дублируем уже добавленные блюда
          const alreadyUsed = [dp.breakfast, dp.lunch, dp.dinner, ...(dp.extras||[])].filter(Boolean).map(d => d.id);
          if (!alreadyUsed.includes(candidate.id)) {
            dp.extras = [...(dp.extras || []), candidate];
          }
          attempts++;
        }
      }

      newPlan[day.key] = dp;
      count++;
    }
    onFill(newPlan);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 200, display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "var(--surf)", borderRadius: "18px 18px 0 0", padding: "20px 16px 32px", width: "100%" }} className="fu">
        <div style={{ fontFamily: "Playfair Display,serif", fontSize: 20, marginBottom: 4 }}>⚡ Auto-fill</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 16 }}>I'll pick breakfast + lunch + dinner for you</div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 8 }}>Calorie goal:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {goals.map(g => (
            <button key={g.val} onClick={() => setKcal(g.val)} style={{
              padding: "10px 14px", borderRadius: 12, border: "1.5px solid",
              borderColor: kcal === g.val ? "var(--gm)" : "var(--bd)",
              background: kcal === g.val ? "var(--gxp)" : "var(--surf)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{g.label}</span>
              <span style={{ fontSize: 11, color: "var(--ink3)" }}>{g.sub}</span>
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 8 }}>How many days:</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {dayOpts.map(d => (
            <button key={d.val} onClick={() => setDays(d.val)} style={{
              flex: 1, padding: "10px 8px", borderRadius: 12, border: "1.5px solid",
              borderColor: days === d.val ? "var(--gm)" : "var(--bd)",
              background: days === d.val ? "var(--gxp)" : "var(--surf)",
              fontWeight: 600, fontSize: 13,
            }}>
              {d.label}<br />
              <span style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 400 }}>{d.sub}</span>
            </button>
          ))}
        </div>

        <button className="btn btn-g" onClick={handleFill} disabled={!kcal || !days}
          style={{ opacity: (!kcal || !days) ? .5 : 1, marginBottom: 10 }}>
          ✨ Fill my week →
        </button>
        <button className="btn btn-out" style={{ width: "100%", justifyContent: "center" }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function PlannerPage({ menu, week, plan, setPlan, onCheckout }) {
  const [selDay, setSelDay]       = useState(week[0]?.key);
  const [activeCat, setActiveCat] = useState("breakfast");
  const [selected, setSelected]   = useState(null);
  const [showAuto, setShowAuto]   = useState(false);
  const [sidePicker, setSidePicker] = useState(null); // { slotKey, dish, sides }

  const day     = week.find(d => d.key === selDay);
  const dayPlan = plan[selDay] || {};
  const sides   = menu.filter(d => d.cat === "side");
  const catItems = menu.filter(d => d.cat === activeCat && !(d.fresh && !day?.freshOk));

  const commitSlot = (sk, dish, side = null) => {
    const entry = { dish, side };
    if (sk === "extras") {
      setPlan(p => {
        const existing = p[selDay]?.extras || [];
        return { ...p, [selDay]: { ...(p[selDay] || {}), extras: [...existing, entry] } };
      });
    } else {
      setPlan(p => ({ ...p, [selDay]: { ...(p[selDay] || {}), [sk]: entry } }));
    }
    setSelected(null);
    setSidePicker(null);
  };

  const placeInSlot = (sk) => {
    if (!selected || !day) return;
    if (day.blocked.has(sk)) return;
    if (selected.fresh && !day.freshOk) return;
    // Есть ли у блюда гарниры?
    const dishSides = (selected.sides || []).map(id => sides.find(s => s.id === id)).filter(Boolean);
    if (dishSides.length > 0) {
      setSidePicker({ slotKey: sk, dish: selected, sides: dishSides });
    } else {
      commitSlot(sk, selected, null);
    }
  };

  const removeSlot = (sk) => {
    setPlan(p => {
      const d = { ...(p[selDay] || {}) };
      delete d[sk];
      return { ...p, [selDay]: d };
    });
  };

  const removeExtra = (idx) => {
    setPlan(p => {
      const extras = [...(p[selDay]?.extras || [])];
      extras.splice(idx, 1);
      return { ...p, [selDay]: { ...(p[selDay] || {}), extras } };
    });
  };

  // Считаем цену и ккал из entry { dish, side }
  const entryKcal  = e => (e?.dish?.kcal || 0) + (e?.side?.kcal || 0);
  const entryPrice = e => (e?.dish?.price || 0) + (e?.side?.price || 0);
  const entryName  = e => e?.side ? `${e.dish.name} + ${e.side.name}` : e?.dish?.name || "";

  const hasAny = Object.values(plan).some(dp =>
    Object.entries(dp).some(([k, v]) => k === "extras" ? v?.length > 0 : !!v)
  );
  const { fee } = calcDelivery(plan, week);
  const foodTotal = Object.values(plan).reduce((s, dp) => {
    return s + Object.entries(dp).reduce((ss, [k, v]) => {
      if (k === "extras") return ss + (v || []).reduce((es, e) => es + entryPrice(e), 0);
      return ss + entryPrice(v);
    }, 0);
  }, 0);

  return (
    <div className="page">
      {/* Auto-fill + Clear buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setShowAuto(true)} style={{
          flex: 2, padding: "10px 14px", borderRadius: 12,
          border: "1.5px dashed var(--gm)", background: "var(--gxp)", color: "var(--g)",
          fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          ⚡ Auto-fill the week
        </button>
        <button onClick={() => { setPlan({}); setSelected(null); }} style={{
          flex: 1, padding: "10px 8px", borderRadius: 12,
          border: "1.5px solid var(--bd2)", background: "var(--surf)", color: "var(--rose)",
          fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          🗑 Clear
        </button>
      </div>

      {/* Day strip */}
      <div className="day-strip" style={{ marginBottom: 12 }}>
        {week.map(d => {
          const dp = plan[d.key] || {};
          const hasDishes = Object.entries(dp).some(([k, v]) => k === "extras" ? v?.length > 0 : !!v);
          return (
            <button key={d.key} className={`dpill${selDay === d.key ? " on" : ""}${d.isDelivery && selDay !== d.key ? " del" : ""}${hasDishes && selDay !== d.key ? " has" : ""}`}
              onClick={() => { setSelDay(d.key); setSelected(null); }}>
              <div style={{ fontSize: 9, fontWeight: 600, opacity: .7 }}>{d.name}</div>
              <div style={{ fontFamily: "Playfair Display,serif", fontSize: 17, fontWeight: 700, lineHeight: 1 }}>{d.num}</div>
              {hasDishes && <div style={{ width: 4, height: 4, borderRadius: "50%", background: selDay === d.key ? "rgba(255,255,255,.7)" : "var(--g)", margin: "2px auto 0" }} />}
            </button>
          );
        })}
      </div>

      {day?.isDelivery && (
        <div style={{ background: "linear-gradient(90deg,#192b16,#2a5c24)", color: "white", borderRadius: 10, padding: "7px 12px", marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
          🚚 Delivery day · Fresh dishes available!
        </div>
      )}

      {/* Daily KBJU summary */}
      {(() => {
        const entries = Object.entries(dayPlan).filter(([k, v]) => k === "extras" ? v?.length > 0 : !!v);
        if (!entries.length) return null;
        const allE = entries.flatMap(([k, v]) => k === "extras" ? (v||[]) : [v]);
        const kcal = allE.reduce((s,e)=>s+(e?.dish?.kcal||0)+(e?.side?.kcal||0),0);
        const p    = allE.reduce((s,e)=>s+(e?.dish?.p||0)+(e?.side?.p||0),0);
        const f    = allE.reduce((s,e)=>s+(e?.dish?.f||0)+(e?.side?.f||0),0);
        const c    = allE.reduce((s,e)=>s+(e?.dish?.c||0)+(e?.side?.c||0),0);
        const price= allE.reduce((s,e)=>s+entryPrice(e),0);
        const pct  = Math.min(100, Math.round(kcal / 2000 * 100));
        const bc   = pct > 105 ? "var(--rose)" : pct >= 70 ? "var(--gm)" : "var(--a)";
        return (
          <div style={{ background: "var(--surf)", borderRadius: 12, border: "1.5px solid var(--bd)", padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: bc }}>{kcal} kcal</span>
                <span style={{ fontSize: 10, color: "var(--ink3)" }}>P{p}g · F{f}g · C{c}g</span>
              </div>
              <span style={{ fontFamily: "Playfair Display,serif", fontSize: 15, fontWeight: 700, color: "var(--g)" }}>{price.toFixed(2)}€</span>
            </div>
            <div style={{ height: 4, borderRadius: 4, background: "var(--surf3)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, background: bc, width: `${pct}%`, transition: "width .4s" }} />
            </div>
            <div style={{ fontSize: 9, color: "var(--ink3)", marginTop: 3 }}>{pct}% of 2000 kcal daily goal</div>
          </div>
        );
      })()}

      {/* Main slots */}
      {SLOTS.map(slot => {
        const entry   = dayPlan[slot.key];
        const blocked = day?.blocked.has(slot.key);
        const isAvail = !blocked && selected && !entry && !(selected.fresh && !day?.freshOk);
        return (
          <div key={slot.key} className={`slot-card${isAvail ? " avl" : ""}${entry ? " fld" : ""}${blocked ? " blk" : ""}`}
            onClick={() => isAvail && placeInSlot(slot.key)}>
            <div className="slot-icon" style={{ background: entry ? "var(--gp)" : blocked ? "var(--surf3)" : "var(--surf2)" }}>
              <span>{slot.label.split(" ")[0]}</span>
              <span className="slot-icon-lbl">{slot.label.split(" ").slice(1).join(" ")}</span>
            </div>
            <div className="slot-content">
              {blocked ? (
                <span style={{ fontSize: 11, color: "var(--ink3)" }}>— {day?.isDelivery ? "prev delivery" : "no delivery"}</span>
              ) : entry ? (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{entry.dish?.name}</div>
                    {entry.side && <div style={{ fontSize: 10, color: "var(--ink2)", marginTop: 1 }}>🍚 {entry.side.name}</div>}
                    <div style={{ fontSize: 11, color: "var(--a)", fontWeight: 700, marginTop: 2 }}>
                      {entryKcal(entry)} kcal · {entryPrice(entry).toFixed(2)}€
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); removeSlot(slot.key); }}
                    style={{ width: 22, height: 22, background: "var(--rose)", color: "white", border: "none", borderRadius: "50%", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
                </>
              ) : isAvail ? (
                <span style={{ fontSize: 12, color: "var(--g)", fontWeight: 600 }}>Tap to place here →</span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--ink3)" }}>
                  {selected && selected.fresh && !day?.freshOk ? "🚫 Fresh only on delivery day" : "Select a dish below"}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Extras slot */}
      <div style={{ borderRadius: "var(--r)", border: "1.5px dashed var(--bd)", background: selected ? "var(--gxp)" : "var(--surf)", marginBottom: 8, overflow: "hidden", transition: "all .13s" }}
        onClick={() => selected && placeInSlot("extras")}>
        <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: (dayPlan.extras?.length > 0) ? "1px solid var(--bd)" : "none" }}>
          <div style={{ width: 44, height: 36, background: "var(--ap)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 14 }}>★</span>
            <span style={{ fontSize: 7, fontWeight: 700, color: "var(--a)" }}>EXTRAS</span>
          </div>
          <span style={{ fontSize: 12, color: selected ? "var(--g)" : "var(--ink3)", fontWeight: selected ? 600 : 400 }}>
            {selected ? "Tap to add as extra →" : "Add extras, snacks, desserts…"}
          </span>
        </div>
        {(dayPlan.extras || []).map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: i < (dayPlan.extras.length - 1) ? "1px solid var(--surf2)" : "none" }}>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
              {e.dish?.name}{e.side ? ` + ${e.side.name}` : ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--a)", fontWeight: 700 }}>{entryPrice(e).toFixed(2)}€</div>
            <button onClick={ev => { ev.stopPropagation(); removeExtra(i); }}
              style={{ width: 20, height: 20, background: "var(--rose)", color: "white", border: "none", borderRadius: "50%", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
          </div>
        ))}
      </div>

      {/* Dish picker */}
      <div className="picker">
        <div className="picker-tabs">
          {CATS.map(c => (
            <button key={c.key} className={`picker-tab${activeCat === c.key ? " on" : ""}`}
              onClick={() => { setActiveCat(c.key); setSelected(null); }}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        <div className="dish-row">
          {catItems.length === 0 && <div style={{ fontSize: 12, color: "var(--ink3)", padding: "16px 0" }}>No dishes</div>}
          {catItems.map(d => (
            <div key={d.id} className={`dish-card${selected?.id === d.id ? " sel" : ""}`}
              onClick={() => setSelected(p => p?.id === d.id ? null : d)}>
              <div className="dish-card-img" style={{ position: "relative", background: "var(--surf2)" }}>
                {d.img_url && <img src={d.img_url} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} onError={e => e.target.style.display = "none"} />}
                {d.fresh && <div style={{ position: "absolute", top: 3, left: 3, background: "rgba(181,113,31,.9)", color: "white", fontSize: 8, fontWeight: 700, borderRadius: 20, padding: "1px 5px", zIndex: 1 }}>⚡</div>}
                {selected?.id === d.id && <div style={{ position: "absolute", inset: 0, background: "rgba(61,122,53,.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}><span style={{ background: "white", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--g)", fontWeight: 900, fontSize: 14 }}>✓</span></div>}
              </div>
              <div className="dish-card-body">
                <div className="dish-card-name">{d.name.slice(0, 22)}</div>
                <div className="dish-card-info">
                  <span style={{ color: "var(--a)", fontWeight: 600 }}>{d.kcal} kcal</span>
                  <span style={{ color: "var(--g)", fontWeight: 700 }}>{d.price}€</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasAny && (
        <button className="btn btn-g" onClick={onCheckout} style={{ marginTop: 4 }}>
          🛒 Order · {(foodTotal + fee).toFixed(2)}€ →
        </button>
      )}

      {showAuto && <AutoFillModal menu={menu} week={week} onFill={p => setPlan(p)} onClose={() => setShowAuto(false)} />}
      {sidePicker && <SidePickerModal dish={sidePicker.dish} sides={sidePicker.sides}
        onSelect={side => commitSlot(sidePicker.slotKey, sidePicker.dish, side)}
        onSkip={() => commitSlot(sidePicker.slotKey, sidePicker.dish, null)} />}
    </div>
  );
}

function SummaryPage({ plan, week, onBack, onConfirm, sending }) {
  const tgName = TG_USER ? `${TG_USER.first_name || ""} ${TG_USER.last_name || ""}`.trim() : "";
  const [name,    setName]    = useState(tgName);
  const [contact, setContact] = useState("");
  const { fee, bt } = calcDelivery(plan, week);
  const BNAMES = ["Mon delivery block", "Wed delivery block", "Fri delivery block"];

  const entryPrice = e => (e?.dish?.price || 0) + (e?.side?.price || 0);
  const entryKcal  = e => (e?.dish?.kcal  || 0) + (e?.side?.kcal  || 0);

  const foodTotal = Object.values(plan).reduce((s, dp) =>
    Object.entries(dp).reduce((ss, [k, v]) => {
      if (k === "extras") return ss + (v || []).reduce((es, e) => es + entryPrice(e), 0);
      return ss + entryPrice(v);
    }, s), 0);
  const total = foodTotal + fee;

  const canConfirm = name.trim().length > 0 && contact.trim().length > 0;

  return (
    <div className="page">
      <div style={{ fontFamily: "Playfair Display,serif", fontSize: 22, marginBottom: 4 }}>Your order</div>
      <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 16 }}>Review before confirming</div>

      {/* Contact form */}
      <div style={{ background: "var(--surf)", borderRadius: "var(--r)", border: "1.5px solid var(--bd)", padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📋 Your details</div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4, fontWeight: 600 }}>Name *</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
            style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid var(--bd)", fontSize: 13, outline: "none", fontFamily: "DM Sans,sans-serif" }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4, fontWeight: 600 }}>Phone or Telegram *</div>
          <input value={contact} onChange={e => setContact(e.target.value)} placeholder="+351 912... or @username"
            style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid var(--bd)", fontSize: 13, outline: "none", fontFamily: "DM Sans,sans-serif" }} />
        </div>
      </div>

      {/* Order lines */}
      {week.filter(d => {
        const dp = plan[d.key] || {};
        return Object.entries(dp).some(([k, v]) => k === "extras" ? v?.length > 0 : !!v);
      }).map(day => {
        const dp = plan[day.key] || {};
        const filled = Object.entries(dp).filter(([k, v]) => k === "extras" ? v?.length > 0 : !!v);
        const allE = filled.flatMap(([k, v]) => k === "extras" ? (v||[]) : [v]);
        const kcal  = allE.reduce((s,e)=>s+(e?.dish?.kcal||0)+(e?.side?.kcal||0),0);
        const price = allE.reduce((s,e)=>s+(e?.dish?.price||0)+(e?.side?.price||0),0);
        return (
          <div key={day.key} className="sum-day fu">
            <div className="sum-day-hdr">
              <span className="sum-day-name">{day.isDelivery ? "🚚 " : "📅 "}{day.name} {day.num} {day.mon}</span>
              <span className="sum-day-kcal">{kcal} kcal · {price.toFixed(2)}€</span>
            </div>
            {filled.map(([sk, v]) => {
              if (sk === "extras") return (v || []).map((e, i) => (
                <div key={`ex${i}`} className="sum-slot">
                  <span style={{ color: "var(--a)" }}>★ Extra</span>
                  <span style={{ fontWeight: 600 }}>
                    {e.dish?.name}{e.side ? ` + ${e.side.name}` : ""}
                    <span style={{ color: "var(--a)" }}> {((e.dish?.price||0)+(e.side?.price||0)).toFixed(2)}€</span>
                  </span>
                </div>
              ));
              const slot = SLOTS.find(s => s.key === sk);
              return (
                <div key={sk} className="sum-slot">
                  <span style={{ color: "var(--ink2)" }}>{slot?.label}</span>
                  <span style={{ fontWeight: 600 }}>
                    {v.dish?.name}{v.side ? ` + ${v.side.name}` : ""}
                    <span style={{ color: "var(--a)" }}> {((v.dish?.price||0)+(v.side?.price||0)).toFixed(2)}€</span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Delivery blocks */}
      <div style={{ marginBottom: 14 }}>
        {Object.entries(bt).map(([bi, bv]) => bv > 0 && (
          <div key={bi} className={`del-block ${bv >= FREE_THRESHOLD ? "free" : "paid"}`}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{BNAMES[bi]}</div>
              {bv < FREE_THRESHOLD && <div style={{ fontSize: 10, color: "var(--a)", marginTop: 2 }}>{bv.toFixed(0)}€ / need {FREE_THRESHOLD}€ for free</div>}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: bv >= FREE_THRESHOLD ? "var(--g)" : "var(--a)" }}>
              {bv >= FREE_THRESHOLD ? "🚚 Free!" : `+${DELIVERY_FEE}€`}
            </span>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--gxp)", borderRadius: "var(--r)", padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>Total</span>
        <span style={{ fontFamily: "Playfair Display,serif", fontSize: 24, fontWeight: 700, color: "var(--g)" }}>{total.toFixed(2)}€</span>
      </div>

      <button className="btn btn-g" onClick={() => canConfirm && onConfirm(name, contact)}
        disabled={sending || !canConfirm}
        style={{ marginBottom: 10, opacity: (!canConfirm || sending) ? .5 : 1 }}>
        {sending ? <span className="spinner" /> : "✅ Confirm order →"}
      </button>
      {!canConfirm && <div style={{ textAlign: "center", fontSize: 11, color: "var(--rose)", marginBottom: 8 }}>Please fill in your name and contact</div>}
      <button className="btn btn-out" style={{ width: "100%", justifyContent: "center" }} onClick={onBack}>← Edit</button>
    </div>
  );
}

function SuccessPage({ total }) {
  useEffect(() => {
    tg?.HapticFeedback?.notificationOccurred("success");
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 60, marginBottom: 16, animation: "pop .4s" }}>🎉</div>
      <h2 style={{ fontSize: 26, marginBottom: 8 }}>Order placed!</h2>
      <p style={{ color: "var(--ink2)", fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
        We'll start cooking right away.<br />
        Total: <strong>{total.toFixed(2)}€</strong>
      </p>
      <div style={{ background: "var(--gxp)", borderRadius: 12, padding: "10px 16px", fontSize: 13, color: "var(--g)", fontWeight: 600 }}>
        📱 Admin notified via Telegram
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════ */
export default function App() {
  const [tab, setTab]       = useState("planner");
  const [menu, setMenu]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [week]              = useState(() => buildWeek());
  const [plan, setPlan]     = useState({});
  const [page, setPage]     = useState("main"); // main | summary | success
  const [sending, setSend]  = useState(false);
  const [orderTotal, setOT] = useState(0);

  useEffect(() => {
    tg?.expand();
    tg?.setHeaderColor("#192b16");
    fetchMenu().then(m => { setMenu(m); setLoad(false); }).catch(() => setLoad(false));
  }, []);

  const handleConfirm = async (clientName, clientContact) => {
    setSend(true);
    const { text, total } = formatSummary(plan, week, clientName);
    const fullText = `${text}\n\n📞 Contact: ${clientContact}`;
    try {
      await sendToBot(fullText);
      if (tg) tg.sendData(JSON.stringify({ plan, total, name: clientName, contact: clientContact }));
    } catch (e) { console.error(e); }
    setOT(total);
    setSend(false);
    setPage("success");
  };

  if (page === "success") return (
    <>
      <style>{CSS}</style>
      <div className="hdr">
        <div><div className="hdr-logo">🥣 SoupScription</div></div>
      </div>
      <SuccessPage total={orderTotal} />
    </>
  );

  if (page === "summary") return (
    <>
      <style>{CSS}</style>
      <div className="hdr">
        <div><div className="hdr-logo">🥣 SoupScription</div><div className="hdr-sub">Mon · Wed · Fri delivery</div></div>
      </div>
      <SummaryPage plan={plan} week={week} onBack={() => setPage("main")} onConfirm={handleConfirm} sending={sending} />
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="hdr">
        <div>
          <div className="hdr-logo">🥣 SoupScription</div>
          <div className="hdr-sub">Mon · Wed · Fri delivery before noon</div>
        </div>
        {TG_USER && <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }}>Hi, {TG_USER.first_name}!</div>}
      </div>

      {tab === "planner" && (
        <PlannerPage menu={menu} week={week} plan={plan} setPlan={setPlan}
          onCheckout={() => setPage("summary")} />
      )}
      {tab === "menu" && <MenuPage menu={menu} loading={loading} />}

      <nav className="bbar">
        <button className={`bbar-btn${tab === "planner" ? " on" : ""}`} onClick={() => setTab("planner")}>
          <span className="bbar-icon">📅</span>Planner
        </button>
        <button className={`bbar-btn${tab === "menu" ? " on" : ""}`} onClick={() => setTab("menu")}>
          <span className="bbar-icon">🍽️</span>Menu
        </button>
      </nav>
    </>
  );
}
