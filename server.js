const express = require('express');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host:     'localhost',
  port:     3306,
  user:     'root',
  password: 'root',
  database: 'teodor-logistica',
});

// ── GET /api/houses ──────────────────────────────────────────────────────────
app.get('/api/houses', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT h.id, h.name AS house_name, h.location, h.lat, h.lng,
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
app.get('/api/totals', async (req, res) => {
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
app.post('/api/houses', async (req, res) => {
  const { name, location, lat, lng } = req.body;
  if (!name || !location) return res.status(400).json({ error: 'Name and location are required.' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO house (name, location, lat, lng) VALUES (?, ?, ?, ?)',
      [name.trim(), location.trim(), lat || null, lng || null]
    );
    const houseId = result.insertId;
    await conn.query('INSERT INTO warehouse (house_id) VALUES (?)', [houseId]);
    await conn.commit();
    res.json({ id: houseId, name, location, lat, lng });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── PUT /api/houses/:id ───────────────────────────────────────────────────────
app.put('/api/houses/:id', async (req, res) => {
  const { name, location, lat, lng } = req.body;
  if (!name || !location) return res.status(400).json({ error: 'Name and location are required.' });
  try {
    await pool.query(
      'UPDATE house SET name=?, location=?, lat=?, lng=? WHERE id=?',
      [name.trim(), location.trim(), lat || null, lng || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/houses/:id ────────────────────────────────────────────────────
app.delete('/api/houses/:id', async (req, res) => {
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
app.get('/api/materials', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM material ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
// Body: { startLat, startLng, startName, destinationHouseId, materials: { "1": 100 }, lang: "en" }
app.post('/api/calculate-order', async (req, res) => {
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

    // Look up destination house
    const [[destRow]] = await pool.query('SELECT * FROM house WHERE id = ?', [destinationHouseId]);
    if (!destRow) return res.status(400).json({ error: m.houseNotFound });
    const destNode = {
      id: destRow.id, name: destRow.name, location: destRow.location,
      lat: parseFloat(destRow.lat), lng: parseFloat(destRow.lng),
    };

    // Exclude destination house from pickup stops
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

    // Build houses map
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

    // Parse order
    const needed = {};
    for (const [matId, qty] of Object.entries(orderInput)) {
      const n = parseFloat(qty);
      if (n > 0) needed[parseInt(matId)] = n;
    }
    if (Object.keys(needed).length === 0) {
      return res.status(400).json({ error: m.noValidQty });
    }

    // ── 1. DISTANCE-AWARE ALLOCATION ─────────────────────────────────────────
    // Score each house by stock-per-km from origin — prefer close houses with high stock.
    // Ties broken by proximity (closer always wins when stock is equal).
    const contributions = {};
    const deficit = {};

    for (const [matId, qtyNeeded] of Object.entries(needed)) {
      let rem = qtyNeeded;
      const mid = parseInt(matId);

      const sorted = allHouses
        .filter(h => h.inventory[mid] && h.inventory[mid].quantity > 0)
        .sort((a, b) => {
          const distA = Math.max(haversine(originNode.lat, originNode.lng, a.lat, a.lng), 0.1);
          const distB = Math.max(haversine(originNode.lat, originNode.lng, b.lat, b.lng), 0.1);
          // Score: units available per km — higher is better
          const scoreA = a.inventory[mid].quantity / distA;
          const scoreB = b.inventory[mid].quantity / distB;
          return scoreB - scoreA;
        });

      for (const house of sorted) {
        if (rem <= 0) break;
        const avail = house.inventory[mid].quantity;
        const take  = Math.min(avail, rem);
        rem -= take;
        if (!contributions[house.id]) contributions[house.id] = {};
        contributions[house.id][mid] = {
          quantity: take,
          name:     house.inventory[mid].name,
          unit:     house.inventory[mid].unit,
        };
      }

      if (rem > 0) {
        const mat = matRows.find(m => m.id === mid);
        deficit[mid] = { quantity: rem, name: mat.name, unit: mat.unit };
      }
    }

    const selectedHouses = allHouses.filter(h => contributions[h.id]);

    // ── 2. NEAREST-NEIGHBOR + 2-OPT ─────────────────────────────────────────
    const nnRoute  = nearestNeighborFrom(originNode, selectedHouses);
    const route    = twoOpt(nnRoute, originNode);

    // Build full waypoints: origin → pickup stops → destination
    const originInRoute = route.find(h => h.id === originNode.id);
    const pickupWaypoints = originInRoute ? route : [originNode, ...route];
    const allWaypoints    = [...pickupWaypoints, destNode];

    // ── 3. NEAREST SUPPLIER when deficit exists ──────────────────────────────
    // Insert supplier between last pickup and destination
    let nearestSupplier = null;
    if (Object.keys(deficit).length > 0) {
      const [suppliers] = await pool.query(
        'SELECT * FROM supplier WHERE lat IS NOT NULL AND lng IS NOT NULL'
      );
      const lastPickup = pickupWaypoints[pickupWaypoints.length - 1];
      let minDist = Infinity;
      for (const s of suppliers) {
        const d = haversine(lastPickup.lat, lastPickup.lng, parseFloat(s.lat), parseFloat(s.lng));
        if (d < minDist) {
          minDist = d;
          nearestSupplier = {
            id: s.id, name: s.name, location: s.location,
            lat: parseFloat(s.lat), lng: parseFloat(s.lng),
            distanceFromLastStop: Math.round(d),
          };
        }
      }
    }

    // Build Google Maps URL: origin → pickups → [supplier] → destination
    const waypointsForMap = nearestSupplier
      ? [...pickupWaypoints, nearestSupplier, destNode]
      : allWaypoints;

    const mapsUrl = waypointsForMap.length >= 2
      ? `https://www.google.com/maps/dir/${waypointsForMap.map(p => `${p.lat},${p.lng}`).join('/')}`
      : `https://www.google.com/maps/search/?api=1&query=${originNode.lat},${originNode.lng}`;

    res.json({
      origin:      { id: originNode.id, name: originNode.name, location: originNode.location },
      destination: { id: destNode.id,   name: destNode.name,   location: destNode.location },
      route:       route.map(h => ({ ...h, contribution: contributions[h.id] })),
      supplier:    nearestSupplier,
      deficit:     Object.values(deficit),
      mapsUrl,
      fullyFulfilled: Object.keys(deficit).length === 0,
      totalStops:     route.length,
      totalDistance:  routeDistance(waypointsForMap),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// 2-opt improvement for open path with fixed first stop (index 0)
function twoOpt(route, origin) {
  if (route.length <= 2) return route;

  // Full path includes origin as position 0 even if not in route array
  const fullPath = route[0]?.id === origin.id ? route : [origin, ...route];
  if (fullPath.length <= 3) return route;

  let best = [...fullPath];
  let improved = true;

  while (improved) {
    improved = false;
    // i starts at 1 to keep origin fixed at position 0
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

  // Return without origin if it wasn't in the original route
  return route[0]?.id === origin.id ? best : best.slice(1);
}

function routeDistance(stops) {
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversine(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
  }
  return Math.round(total);
}

const PORT = 3000;
app.listen(PORT, () => console.log(`Teodor Dashboard → http://localhost:${PORT}`));
