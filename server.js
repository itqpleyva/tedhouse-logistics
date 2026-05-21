const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');
const session = require('express-session');
const bcrypt  = require('bcryptjs');

// ── TELEGRAM CONFIG ──────────────────────────────────────────────────────────
// 1. Create a bot via @BotFather on Telegram → copy the token here
// 2. Add the bot as an Admin to your channel
// 3. Set the channel username (@mychannel) or numeric chat ID (-100xxxxxxxxxx)
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN   || '8990062843:AAHYRpDaILe1KHLtwzUO8JfZZeUzcKbLq-0';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003959764722';

const app = express();
app.use(express.json());

app.use(session({
  secret: 'tedhouse-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host:     'localhost',
  port:     3306,
  user:     'root',
  password: 'root',
  database: 'teodor-logistica',
});

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// ── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ username: user.username, role: user.role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

// ── GET /api/houses ──────────────────────────────────────────────────────────
app.get('/api/houses', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.id, h.name AS house_name, h.location, h.lat, h.lng,
             h.start_date, h.current_phase,
             m.name AS material, m.unit, m.price, i.quantity,
             (i.quantity * m.price) AS subtotal
      FROM house h
      LEFT JOIN warehouse w ON w.house_id    = h.id
      LEFT JOIN inventory i ON i.warehouse_id = w.id
      LEFT JOIN material  m ON m.id           = i.material_id
      ORDER BY h.id, m.id
    `);
    const houses = {};
    for (const row of rows) {
      if (!houses[row.id]) {
        houses[row.id] = { id: row.id, name: row.house_name, location: row.location,
          lat: row.lat != null ? parseFloat(row.lat) : null,
          lng: row.lng != null ? parseFloat(row.lng) : null,
          start_date: row.start_date ? row.start_date.toISOString().slice(0,10) : null,
          current_phase: row.current_phase || null,
          materials: [], totalValue: 0 };
      }
      if (row.material != null) {
        const subtotal = parseFloat(row.subtotal);
        houses[row.id].materials.push({
          name: row.material, unit: row.unit,
          price: parseFloat(row.price),
          quantity: parseFloat(row.quantity),
          subtotal,
        });
        houses[row.id].totalValue += subtotal;
      }
    }
    res.json(Object.values(houses));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/totals ──────────────────────────────────────────────────────────
app.get('/api/totals', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.name, m.unit, m.price,
             SUM(i.quantity) AS total,
             SUM(i.quantity * m.price) AS total_value
      FROM inventory i JOIN material m ON m.id = i.material_id
      GROUP BY m.id, m.name, m.unit, m.price ORDER BY m.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/houses ─────────────────────────────────────────────────────────
app.post('/api/houses', requireAdmin, async (req, res) => {
  const { name, location, lat, lng, start_date, current_phase } = req.body;
  if (!name || !location) return res.status(400).json({ error: 'Name and location are required.' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO house (name, location, lat, lng, start_date, current_phase) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), location.trim(), lat || null, lng || null, start_date || null, current_phase?.trim() || null]
    );
    const houseId = result.insertId;
    await conn.query('INSERT INTO warehouse (house_id) VALUES (?)', [houseId]);
    await conn.commit();
    res.json({ id: houseId, name, location, lat, lng, start_date, current_phase });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── PUT /api/houses/:id ───────────────────────────────────────────────────────
app.put('/api/houses/:id', requireAdmin, async (req, res) => {
  const { name, location, lat, lng, start_date, current_phase } = req.body;
  if (!name || !location) return res.status(400).json({ error: 'Name and location are required.' });
  try {
    await pool.query(
      'UPDATE house SET name=?, location=?, lat=?, lng=?, start_date=?, current_phase=? WHERE id=?',
      [name.trim(), location.trim(), lat || null, lng || null, start_date || null, current_phase?.trim() || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/houses/:id ────────────────────────────────────────────────────
app.delete('/api/houses/:id', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[wh]] = await conn.query('SELECT id FROM warehouse WHERE house_id=?', [req.params.id]);
    if (wh) await conn.query('DELETE FROM inventory WHERE warehouse_id=?', [wh.id]);
    await conn.query('DELETE FROM warehouse WHERE house_id=?', [req.params.id]);
    await conn.query('DELETE FROM house WHERE id=?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── GET /api/materials ───────────────────────────────────────────────────────
app.get('/api/materials', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM material ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/houses/:id/inventory ────────────────────────────────────────────
app.put('/api/houses/:id/inventory', requireAdmin, async (req, res) => {
  const quantities = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[wh]] = await conn.query('SELECT id FROM warehouse WHERE house_id = ?', [req.params.id]);
    if (!wh) return res.status(404).json({ error: 'House not found' });
    for (const [matId, qty] of Object.entries(quantities)) {
      const q = parseFloat(qty);
      if (isNaN(q) || q < 0) continue;
      const [[existing]] = await conn.query(
        'SELECT id FROM inventory WHERE warehouse_id = ? AND material_id = ?',
        [wh.id, parseInt(matId)]
      );
      if (existing) {
        await conn.query('UPDATE inventory SET quantity = ? WHERE id = ?', [q, existing.id]);
      } else {
        await conn.query(
          'INSERT INTO inventory (warehouse_id, material_id, quantity) VALUES (?, ?, ?)',
          [wh.id, parseInt(matId), q]
        );
      }
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── server-side i18n for error messages ─────────────────────────────────────
const serverMsgs = {
  en: {
    noStartHouse:  'Please pick a starting location on the map.',
    noDestHouse:   'Please select a destination house.',
    houseNotFound: 'Destination house not found.',
    noValidQty:    'Order has no valid quantities.',
  },
  bg: {
    noStartHouse:  'Моля изберете начална локация на картата.',
    noDestHouse:   'Моля изберете целева къща.',
    houseNotFound: 'Целевата къща не е намерена.',
    noValidQty:    'Поръчката няма валидни количества.',
  },
};

// ── POST /api/calculate-order ────────────────────────────────────────────────
app.post('/api/calculate-order', requireAuth, async (req, res) => {
  try {
    const { startLat, startLng, startName, destinationHouseId, materials: orderInput, lang = 'en' } = req.body;
    const m = serverMsgs[lang] || serverMsgs.en;

    if (startLat == null || startLng == null) return res.status(400).json({ error: m.noStartHouse });
    if (!destinationHouseId) return res.status(400).json({ error: m.noDestHouse });

    const [matRows] = await pool.query('SELECT * FROM material ORDER BY id');

    const originNode = {
      id: 'gps', name: startName || 'Driver location',
      location: `${parseFloat(startLat).toFixed(5)}, ${parseFloat(startLng).toFixed(5)}`,
      lat: parseFloat(startLat), lng: parseFloat(startLng),
    };

    const [[destRow]] = await pool.query('SELECT * FROM house WHERE id = ?', [destinationHouseId]);
    if (!destRow) return res.status(400).json({ error: m.houseNotFound });
    const destNode = {
      id: destRow.id, name: destRow.name, location: destRow.location,
      lat: parseFloat(destRow.lat), lng: parseFloat(destRow.lng),
    };

    const [rows] = await pool.query(`
      SELECT h.id, h.name, h.location, h.lat, h.lng,
             m.id AS mat_id, m.name AS mat_name, m.unit, i.quantity
      FROM house h
      JOIN warehouse w ON w.house_id    = h.id
      JOIN inventory i ON i.warehouse_id = w.id
      JOIN material  m ON m.id           = i.material_id
      WHERE i.quantity > 0 AND h.lat IS NOT NULL AND h.id != ?
      ORDER BY h.id, m.id
    `, [destinationHouseId]);

    const housesMap = {};
    for (const row of rows) {
      if (!housesMap[row.id]) {
        housesMap[row.id] = {
          id: row.id, name: row.name, location: row.location,
          lat: parseFloat(row.lat), lng: parseFloat(row.lng),
          inventory: {},
        };
      }
      housesMap[row.id].inventory[row.mat_id] = {
        name: row.mat_name, unit: row.unit, quantity: parseFloat(row.quantity),
      };
    }
    const allHouses = Object.values(housesMap);

    const needed = {};
    for (const [matId, qty] of Object.entries(orderInput)) {
      const n = parseFloat(qty);
      if (n > 0) needed[parseInt(matId)] = n;
    }
    if (Object.keys(needed).length === 0) {
      return res.status(400).json({ error: m.noValidQty });
    }

    // Subtract whatever the destination house already has in stock —
    // only the remaining gap needs to be picked up from other houses.
    const [destInvRows] = await pool.query(`
      SELECT i.material_id, i.quantity
      FROM warehouse w JOIN inventory i ON i.warehouse_id = w.id
      WHERE w.house_id = ?
    `, [destinationHouseId]);
    const destAlreadyHas = {};
    for (const r of destInvRows) destAlreadyHas[r.material_id] = parseFloat(r.quantity);
    for (const mid of Object.keys(needed)) {
      const alreadyHere = destAlreadyHas[parseInt(mid)] || 0;
      needed[parseInt(mid)] = Math.max(0, needed[parseInt(mid)] - alreadyHere);
    }
    // Drop materials that the destination already fully covers
    for (const mid of Object.keys(needed)) {
      if (needed[mid] === 0) delete needed[mid];
    }
    // If destination already has everything, return immediately with no pickups needed
    if (Object.keys(needed).length === 0) {
      return res.json({
        origin:      { id: originNode.id, name: originNode.name, location: originNode.location },
        destination: { id: destNode.id,   name: destNode.name,   location: destNode.location },
        route: [], deficit: [], mapsUrl: null,
        fullyFulfilled: true, totalStops: 0,
        totalDistance: Math.round(haversine(originNode.lat, originNode.lng, destNode.lat, destNode.lng)),
      });
    }

    const distOf = h => Math.max(haversine(originNode.lat, originNode.lng, h.lat, h.lng), 0.1);

    // Houses that carry at least one needed material
    const relevantHouses = allHouses.filter(h =>
      Object.keys(needed).some(mid => (h.inventory[parseInt(mid)]?.quantity || 0) > 0)
    );

    // True when the subset can fully supply every ordered material
    function coversDemand(subset) {
      for (const [mid, qty] of Object.entries(needed)) {
        const have = subset.reduce((s, h) => s + (h.inventory[parseInt(mid)]?.quantity || 0), 0);
        if (have < qty) return false;
      }
      return true;
    }

    let selectedHouses = [];
    let route = [];

    const N = relevantHouses.length;
    if (N > 0 && N <= 15) {
      // Enumerate every non-empty subset; keep the one with the shortest full route
      let bestDist = Infinity;
      for (let mask = 1; mask < (1 << N); mask++) {
        const subset = [];
        for (let i = 0; i < N; i++) { if (mask & (1 << i)) subset.push(relevantHouses[i]); }
        if (!coversDemand(subset)) continue;
        const ord  = twoOpt(nearestNeighborFrom(originNode, subset), originNode);
        const dist = routeDistance([originNode, ...ord, destNode]);
        if (dist < bestDist) { bestDist = dist; selectedHouses = subset; route = ord; }
      }
    } else if (N > 15) {
      // Greedy fallback: quantity/distance score
      const picked = new Set();
      for (const [matId, qty] of Object.entries(needed)) {
        let rem = qty;
        const mid = parseInt(matId);
        const sorted = allHouses
          .filter(h => h.inventory[mid]?.quantity > 0)
          .sort((a, b) => (b.inventory[mid].quantity / distOf(b)) - (a.inventory[mid].quantity / distOf(a)));
        for (const h of sorted) { if (rem <= 0) break; picked.add(h.id); rem -= h.inventory[mid].quantity; }
      }
      selectedHouses = allHouses.filter(h => picked.has(h.id));
      route = twoOpt(nearestNeighborFrom(originNode, selectedHouses), originNode);
    }

    // Partial-coverage fallback: if no subset fully covers demand (stock shortage),
    // visit all relevant houses to collect as much as possible and report the deficit.
    if (selectedHouses.length === 0 && relevantHouses.length > 0) {
      selectedHouses = relevantHouses;
      route = twoOpt(nearestNeighborFrom(originNode, selectedHouses), originNode);
    }

    // Allocate materials within the selected set (closest house first per material)
    const contributions = {};
    const deficit = {};
    const selectionReason = selectedHouses.length === 1 ? 'optimal_single' : 'optimal_multi';

    for (const [matId, qtyNeeded] of Object.entries(needed)) {
      let rem = qtyNeeded;
      const mid = parseInt(matId);
      const providers = selectedHouses
        .filter(h => h.inventory[mid]?.quantity > 0)
        .sort((a, b) => distOf(a) - distOf(b));

      for (const house of providers) {
        if (rem <= 0) break;
        const avail = house.inventory[mid].quantity;
        const take  = Math.min(avail, rem);
        rem -= take;
        if (!contributions[house.id]) contributions[house.id] = {};
        contributions[house.id][mid] = {
          quantity: take,
          name:     house.inventory[mid].name,
          unit:     house.inventory[mid].unit,
          selectionReason,
          distanceFromOrigin: Math.round(distOf(house)),
          availableQty: avail,
        };
      }
      if (rem > 0) {
        const mat = matRows.find(m => m.id === mid);
        deficit[mid] = { quantity: rem, name: mat.name, unit: mat.unit };
      }
    }

    const originInRoute = route.find(h => h.id === originNode.id);
    const pickupWaypoints = originInRoute ? route : [originNode, ...route];
    const allWaypoints    = [...pickupWaypoints, destNode];

    const mapsUrl = allWaypoints.length >= 2
      ? `https://www.google.com/maps/dir/${allWaypoints.map(p => `${p.lat},${p.lng}`).join('/')}`
      : `https://www.google.com/maps/search/?api=1&query=${originNode.lat},${originNode.lng}`;

    // Build a summary of what the destination already had in stock
    const destContribution = {};
    for (const [matId, origQty] of Object.entries(orderInput)) {
      const mid = parseInt(matId);
      const ordered = parseFloat(origQty);
      const alreadyHere = destAlreadyHas[mid] || 0;
      if (ordered > 0 && alreadyHere > 0) {
        const mat = matRows.find(m => m.id === mid);
        destContribution[mid] = {
          quantity: Math.min(alreadyHere, ordered),
          name: mat.name, unit: mat.unit,
        };
      }
    }

    res.json({
      origin:      { id: originNode.id, name: originNode.name, location: originNode.location },
      destination: { id: destNode.id,   name: destNode.name,   location: destNode.location },
      route:       route.map(h => ({ ...h, contribution: contributions[h.id] })),
      deficit:     Object.values(deficit),
      destContribution: Object.keys(destContribution).length > 0 ? destContribution : null,
      mapsUrl,
      fullyFulfilled: Object.keys(deficit).length === 0,
      totalStops:     route.length,
      totalDistance:  routeDistance(allWaypoints),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/send-telegram ──────────────────────────────────────────────────
app.post('/api/send-telegram', requireAuth, async (req, res) => {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(503).json({ error: 'Telegram not configured. Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in server.js.' });
  }

  const { origin, destination, route, deficit, destContribution, totalDistance, totalStops, fullyFulfilled, fuelCost, fuelLitres, mapsUrl } = req.body;

  // Build the message text (HTML parse mode)
  const lines = [];
  lines.push('🚛 <b>TEDHOUSE LOGISTICS — Route Proposal</b>');
  lines.push('');
  lines.push(`📍 <b>Origin:</b> ${origin.name}`);
  lines.push(`🏁 <b>Destination:</b> ${destination.name}`);
  lines.push('');

  if (route && route.length > 0) {
    lines.push(`<b>Pickup stops:</b>`);
    route.forEach((stop, i) => {
      lines.push(`${i + 1}. <b>${stop.name}</b> — ${stop.location}`);
      if (stop.contribution) {
        Object.values(stop.contribution).forEach(c => {
          lines.push(`   • ${c.name}: ${c.quantity} ${c.unit}`);
        });
      }
    });
    lines.push('');
  } else {
    lines.push('ℹ️ No pickup stops needed.');
    lines.push('');
  }

  if (destContribution) {
    lines.push('<b>Already at destination:</b>');
    Object.values(destContribution).forEach(c => {
      lines.push(`   ✅ ${c.name}: ${c.quantity} ${c.unit}`);
    });
    lines.push('');
  }

  if (deficit && deficit.length > 0) {
    lines.push('⚠️ <b>Insufficient stock — deficit:</b>');
    deficit.forEach(d => lines.push(`   • ${d.name}: ${d.quantity} ${d.unit} missing`));
    lines.push('');
  }

  lines.push(`📏 Total distance: ~<b>${totalDistance} km</b>`);
  if (fuelCost != null) lines.push(`⛽ Fuel estimate: ~<b>€${Number(fuelCost).toFixed(2)}</b> (${Number(fuelLitres).toFixed(1)} L)`);
  lines.push('');
  lines.push(fullyFulfilled ? '✅ <b>Order fully covered</b>' : '⚠️ <b>Order partially covered</b>');
  if (mapsUrl) lines.push(`\n🗺 <a href="${mapsUrl}">Open route in Google Maps</a>`);
  lines.push('');
  lines.push('<i>Sent from TEDHOUSE Logistics dashboard</i>');

  const text = lines.join('\n');

  try {
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    const result = await response.json();
    if (!result.ok) return res.status(400).json({ error: result.description || 'Telegram API error' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestNeighborFrom(origin, stops) {
  if (stops.length === 0) return [];
  const visited = new Set();
  const route   = [];
  let current   = origin;

  const originStop = stops.find(s => s.id === origin.id);
  if (originStop) {
    visited.add(origin.id);
    route.push(originStop);
    current = originStop;
  }

  while (route.length < stops.length) {
    let nearest = null, minDist = Infinity;
    for (const s of stops) {
      if (visited.has(s.id)) continue;
      const d = haversine(current.lat, current.lng, s.lat, s.lng);
      if (d < minDist) { minDist = d; nearest = s; }
    }
    if (!nearest) break;
    visited.add(nearest.id);
    route.push(nearest);
    current = nearest;
  }
  return route;
}

function twoOpt(route, origin) {
  if (route.length <= 2) return route;
  const fullPath = route[0]?.id === origin.id ? route : [origin, ...route];
  if (fullPath.length <= 3) return route;

  let best = [...fullPath];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const before = haversine(best[i - 1].lat, best[i - 1].lng, best[i].lat, best[i].lng)
                     + (j + 1 < best.length
                        ? haversine(best[j].lat, best[j].lng, best[j + 1].lat, best[j + 1].lng)
                        : 0);
        const after  = haversine(best[i - 1].lat, best[i - 1].lng, best[j].lat, best[j].lng)
                     + (j + 1 < best.length
                        ? haversine(best[i].lat, best[i].lng, best[j + 1].lat, best[j + 1].lng)
                        : 0);
        if (after < before - 0.01) {
          best = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          improved = true;
        }
      }
    }
  }

  return route[0]?.id === origin.id ? best : best.slice(1);
}

function routeDistance(stops) {
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversine(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
  }
  return Math.round(total);
}

// ── TELEGRAM BOT — channel order listener ───────────────────────────────────
// Default depot coordinates used when no "origin:lat,lng" is in the message.
// Change these to your main warehouse / starting point.
const DEFAULT_ORIGIN_LAT = 42.6977;   // Sofia centre
const DEFAULT_ORIGIN_LNG = 23.3219;
const DEFAULT_ORIGIN_NAME = 'Default depot (Sofia)';

async function tgSend(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) { console.error('tgSend error:', e.message); }
}

// Parse a channel post using free-form scanning — no fixed format required.
// Scans the full text for any house name and any material/quantity pairs
// regardless of word order or language.
async function handleChannelRoute(chatId, text) {
  const [houses]    = await pool.query('SELECT id, name, location FROM house ORDER BY id');
  const [materials] = await pool.query('SELECT id, name, unit FROM material ORDER BY id');

  // Extract optional "origin:lat,lng" anywhere in the message
  let originLat = DEFAULT_ORIGIN_LAT;
  let originLng = DEFAULT_ORIGIN_LNG;
  let originName = DEFAULT_ORIGIN_NAME;
  const originMatch = text.match(/origin:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (originMatch) {
    originLat  = parseFloat(originMatch[1]);
    originLng  = parseFloat(originMatch[2]);
    originName = `${originLat.toFixed(4)}, ${originLng.toFixed(4)}`;
  }
  const cleanText = text.replace(/origin:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/i, '');
  const lowerText = cleanText.toLowerCase();

  // ── Find destination house ──────────────────────────────────────────────────
  // Pick the house whose name appears in the text; prefer longest name match.
  let destHouse = null;
  for (const h of [...houses].sort((a, b) => b.name.length - a.name.length)) {
    if (lowerText.includes(h.name.toLowerCase())) { destHouse = h; break; }
  }
  // Silently ignore messages that don't mention any known house
  if (!destHouse) return;

  // ── Find material / quantity pairs ─────────────────────────────────────────
  // For each material, check if its name appears in the text, then look for
  // a number within a ±30-character window around the material mention.
  const orderMaterials = {};
  for (const mat of [...materials].sort((a, b) => b.name.length - a.name.length)) {
    const matLower = mat.name.toLowerCase();
    const idx = lowerText.indexOf(matLower);
    if (idx === -1) continue;

    const windowBefore = lowerText.substring(Math.max(0, idx - 30), idx);
    const windowAfter  = lowerText.substring(idx + matLower.length, idx + matLower.length + 30);

    // Number after material name: "lumber 1000", "lumber: 1000", "lumber de 1000"
    const afterMatch  = windowAfter.match(/^[\s:,de]*(\d+(?:[.,]\d+)?)/i);
    // Number before material name: "1000 lumber", "1000 de lumber"
    const beforeMatch = windowBefore.match(/(\d+(?:[.,]\d+)?)[\s\w]{0,10}$/);

    const raw = afterMatch?.[1] ?? beforeMatch?.[1];
    if (raw) {
      const qty = parseFloat(raw.replace(',', '.'));
      if (qty > 0) orderMaterials[mat.id] = (orderMaterials[mat.id] || 0) + qty;
    }
  }

  // Silently ignore messages that mention a house but no recognisable materials
  if (Object.keys(orderMaterials).length === 0) return;

  await tgSend(chatId, '⏳ Calculating optimal route…');

  try {
    const originNode = { id: 'gps', name: originName, lat: originLat, lng: originLng };

    const [[destRow]] = await pool.query('SELECT * FROM house WHERE id = ?', [destHouse.id]);
    const destNode = {
      id: destRow.id, name: destRow.name, location: destRow.location,
      lat: parseFloat(destRow.lat), lng: parseFloat(destRow.lng),
    };

    const [rows] = await pool.query(`
      SELECT h.id, h.name, h.location, h.lat, h.lng,
             m.id AS mat_id, m.name AS mat_name, m.unit, i.quantity
      FROM house h
      JOIN warehouse w ON w.house_id    = h.id
      JOIN inventory i ON i.warehouse_id = w.id
      JOIN material  m ON m.id           = i.material_id
      WHERE i.quantity > 0 AND h.lat IS NOT NULL AND h.id != ?
      ORDER BY h.id, m.id
    `, [destHouse.id]);

    const housesMap = {};
    for (const row of rows) {
      if (!housesMap[row.id]) {
        housesMap[row.id] = {
          id: row.id, name: row.name, location: row.location,
          lat: parseFloat(row.lat), lng: parseFloat(row.lng), inventory: {},
        };
      }
      housesMap[row.id].inventory[row.mat_id] = {
        name: row.mat_name, unit: row.unit, quantity: parseFloat(row.quantity),
      };
    }
    const allHouses = Object.values(housesMap);
    const [matRows] = await pool.query('SELECT * FROM material ORDER BY id');

    const needed = {};
    for (const [matId, qty] of Object.entries(orderMaterials)) {
      if (qty > 0) needed[parseInt(matId)] = qty;
    }

    // Subtract what the destination already holds
    const [destInvRows] = await pool.query(`
      SELECT i.material_id, i.quantity
      FROM warehouse w JOIN inventory i ON i.warehouse_id = w.id
      WHERE w.house_id = ?
    `, [destHouse.id]);
    const destAlreadyHas = {};
    for (const r of destInvRows) destAlreadyHas[r.material_id] = parseFloat(r.quantity);
    const destContrib = {};
    for (const mid of Object.keys(needed)) {
      const alreadyHere = destAlreadyHas[parseInt(mid)] || 0;
      if (alreadyHere > 0) {
        const mat = matRows.find(m => m.id === parseInt(mid));
        destContrib[mid] = { name: mat.name, unit: mat.unit, qty: Math.min(alreadyHere, needed[parseInt(mid)]) };
      }
      needed[parseInt(mid)] = Math.max(0, needed[parseInt(mid)] - alreadyHere);
      if (needed[parseInt(mid)] === 0) delete needed[parseInt(mid)];
    }

    if (Object.keys(needed).length === 0) {
      return tgSend(chatId,
        `✅ <b>No pickups needed!</b>\n🏠 <b>${destNode.name}</b> already has everything in stock.\n` +
        `📏 Direct distance: ${Math.round(haversine(originLat, originLng, destNode.lat, destNode.lng))} km`
      );
    }

    const distOf = h => Math.max(haversine(originLat, originLng, h.lat, h.lng), 0.1);
    const relevantHouses = allHouses.filter(h =>
      Object.keys(needed).some(mid => (h.inventory[parseInt(mid)]?.quantity || 0) > 0)
    );
    function coversDemand(subset) {
      for (const [mid, qty] of Object.entries(needed)) {
        const have = subset.reduce((s, h) => s + (h.inventory[parseInt(mid)]?.quantity || 0), 0);
        if (have < qty) return false;
      }
      return true;
    }

    let selectedHouses = [], route = [];
    const N = relevantHouses.length;
    if (N > 0 && N <= 15) {
      let bestDist = Infinity;
      for (let mask = 1; mask < (1 << N); mask++) {
        const subset = [];
        for (let b = 0; b < N; b++) { if (mask & (1 << b)) subset.push(relevantHouses[b]); }
        if (!coversDemand(subset)) continue;
        const ord  = twoOpt(nearestNeighborFrom(originNode, subset), originNode);
        const dist = routeDistance([originNode, ...ord, destNode]);
        if (dist < bestDist) { bestDist = dist; selectedHouses = subset; route = ord; }
      }
    } else if (N > 15) {
      const picked = new Set();
      for (const [matId, qty] of Object.entries(needed)) {
        let rem = qty; const mid = parseInt(matId);
        const sorted = allHouses.filter(h => h.inventory[mid]?.quantity > 0)
          .sort((a, b) => (b.inventory[mid].quantity / distOf(b)) - (a.inventory[mid].quantity / distOf(a)));
        for (const h of sorted) { if (rem <= 0) break; picked.add(h.id); rem -= h.inventory[mid].quantity; }
      }
      selectedHouses = allHouses.filter(h => picked.has(h.id));
      route = twoOpt(nearestNeighborFrom(originNode, selectedHouses), originNode);
    }
    if (selectedHouses.length === 0 && relevantHouses.length > 0) {
      selectedHouses = relevantHouses;
      route = twoOpt(nearestNeighborFrom(originNode, selectedHouses), originNode);
    }

    // Allocate materials to stops
    const contributions = {};
    for (const h of route) contributions[h.id] = [];
    const remaining2 = { ...needed };
    for (const mid of Object.keys(remaining2)) {
      const providers = [...route]
        .filter(h => h.inventory[parseInt(mid)]?.quantity > 0)
        .sort((a, b) => distOf(a) - distOf(b));
      for (const h of providers) {
        if (remaining2[parseInt(mid)] <= 0) break;
        const take = Math.min(h.inventory[parseInt(mid)].quantity, remaining2[parseInt(mid)]);
        contributions[h.id].push({ name: h.inventory[parseInt(mid)].name, unit: h.inventory[parseInt(mid)].unit, take });
        remaining2[parseInt(mid)] -= take;
      }
    }
    const deficit = Object.entries(remaining2)
      .filter(([, v]) => v > 0)
      .map(([mid, qty]) => { const mat = matRows.find(m => m.id === parseInt(mid)); return `${mat?.name || mid}: ${qty} ${mat?.unit || ''}`; });

    // Build Google Maps link
    const waypoints = [originNode, ...route, destNode];
    const mapsUrl = `https://www.google.com/maps/dir/${waypoints.map(p => `${p.lat},${p.lng}`).join('/')}`;
    const totalDist = routeDistance(waypoints);

    // Format reply
    const lines = [];
    lines.push(`🚛 <b>Route → ${destNode.name}</b>`);
    lines.push(`📍 Origin: ${originName}`);
    lines.push(`📏 Total distance: <b>${totalDist} km</b>`);
    lines.push('');

    if (Object.keys(destContrib).length > 0) {
      lines.push('✅ <b>Already at destination:</b>');
      for (const c of Object.values(destContrib)) lines.push(`  • ${c.name}: ${c.qty} ${c.unit}`);
      lines.push('');
    }

    if (route.length > 0) {
      lines.push(`<b>Pickup stops (${route.length}):</b>`);
      for (let idx = 0; idx < route.length; idx++) {
        const h = route[idx];
        lines.push(`${idx + 1}. 🏗 <b>${h.name}</b> — ${h.location}`);
        for (const a of contributions[h.id]) lines.push(`   📦 ${a.name}: ${a.take} ${a.unit}`);
      }
    } else {
      lines.push('ℹ️ No pickup stops needed.');
    }

    if (deficit.length > 0) {
      lines.push('');
      lines.push('⚠️ <b>Stock shortage:</b>');
      for (const d of deficit) lines.push(`  • ${d}`);
    }

    lines.push('');
    lines.push(deficit.length === 0 ? '✅ Order fully covered' : '⚠️ Order partially covered');
    lines.push(`🗺 <a href="${mapsUrl}">Open in Google Maps</a>`);

    await tgSend(chatId, lines.join('\n'));
  } catch (e) {
    console.error('Bot route error:', e);
    await tgSend(chatId, `❌ Error: ${e.message}`);
  }
}

// Long-poll for channel_post updates
let tgPollOffset = 0;
async function tgPollLoop() {
  console.log('Telegram bot polling started…');
  while (true) {
    try {
      const res  = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${tgPollOffset}&timeout=25&allowed_updates=["channel_post"]`
      );
      if (!res.ok) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const data = await res.json();
      for (const update of (data.result || [])) {
        tgPollOffset = update.update_id + 1;
        const post = update.channel_post;
        if (!post?.text) continue;
        const txt = post.text.trim();
        handleChannelRoute(String(post.chat.id), txt).catch(e => console.error('handleChannelRoute:', e));
      }
    } catch (e) {
      console.error('tgPollLoop error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Teodor Dashboard → http://localhost:${PORT}`);
  tgPollLoop();
});
