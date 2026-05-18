# TEDHOUSE LOGISTICS

Materials inventory and route optimization dashboard for warehouse management.

---

## Prerequisites

- [Node.js](https://nodejs.org) (LTS version)
- [MySQL](https://dev.mysql.com/downloads/installer/) (or XAMPP / WAMP)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/itqpleyva/tedhouse-logistics.git
cd tedhouse-logistics
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Create the database in MySQL, then import the included dump file:

```bash
mysql -u root -p -e "CREATE DATABASE \`teodor-logistica\`;"
mysql -u root -p teodor-logistica < database.sql
```

This creates all tables and loads the existing data automatically.

### 4. Configure database credentials

Open `server.js` and update the MySQL password if needed:

```js
const pool = mysql.createPool({
  host:     'localhost',
  port:     3306,
  user:     'root',
  password: 'root',   // change this to your MySQL password
  database: 'teodor-logistica',
});
```

### 5. Start the app

```bash
node server.js
```

Open **http://localhost:3000** in your browser.

---

## Default Accounts

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin    | Admin |
| user     | user     | User  |

## Role-Based Access

| Feature                          | Admin | User |
|----------------------------------|:-----:|:----:|
| View dashboard & inventory       | ✅    | ✅   |
| Search houses                    | ✅    | ✅   |
| Calculate optimal route          | ✅    | ✅   |
| Export PDF report                | ✅    | ✅   |
| Language toggle (BG / EN)        | ✅    | ✅   |
| Add house                        | ✅    | ✗    |
| Edit house                       | ✅    | ✗    |
| Delete house                     | ✅    | ✗    |
| Update stock (inventory)         | ✅    | ✗    |

Permissions are enforced both in the UI (buttons hidden for `user` role) and on the server (mutation endpoints return `403 Forbidden` if called without admin role). Sessions expire after 8 hours.

---

## Route Calculation Algorithm

The route is calculated server-side in `POST /api/calculate-order` using the following steps.

### Step 1 — Collect inputs

The driver provides:
- **Starting GPS coordinates** (picked on the map)
- **Destination house** (where materials are needed)
- **Ordered quantities** per material (e.g. 10 screws, 50 m² of tiles)

### Step 2 — Query candidate houses

The server fetches every house **except the destination** that:
- has GPS coordinates stored
- has at least one ordered material in stock (quantity > 0)

These are the *relevant houses* — the pool of potential pickup stops.

### Step 3 — Find the optimal subset of pickup stops

The goal is to find the **smallest total route distance** (origin → pickup stops → destination) while collectively covering the full order.

**When relevant houses ≤ 15 (exhaustive search):**

Every non-empty subset of relevant houses is evaluated:

1. Check whether the subset's combined stock covers all ordered quantities — skip it if not.
2. For valid subsets, order the stops with **Nearest Neighbor** starting from the driver's origin, then improve the order with **2-opt** (see below).
3. Compute the total route distance: `origin → ordered stops → destination` using the Haversine formula.
4. Keep whichever subset produces the shortest total distance.

This guarantees the globally optimal set of stops for ≤ 15 candidates. Going to multiple nearby houses is preferred over going to one distant house if the total trip is shorter.

**When relevant houses > 15 (greedy fallback):**

A per-material greedy score is used:

```
score = quantity_available / distance_from_origin
```

Houses are ranked by score (descending) and selected until demand is met, which favours dense nearby stock over sparse distant stock.

### Step 4 — Order the stops (Nearest Neighbor + 2-opt)

Given the chosen set of pickup houses, the visit order is optimised:

1. **Nearest Neighbor** — starting from the driver's origin, repeatedly visit the closest unvisited house until all stops are included.
2. **2-opt improvement** — swap pairs of edges in the route and keep the swap if it shortens the total distance. Repeat until no improving swap exists.

### Step 5 — Allocate materials to stops

Within the selected set of houses, each material is allocated to the closest house (by distance from origin) that still has remaining stock, taking as much as available until the ordered quantity is met.

If total stock across all relevant houses is less than the ordered quantity, the shortfall is reported as a **deficit** in the results.

### Step 6 — Build the final route

```
Driver origin → [pickup stop 1] → [pickup stop 2] → … → Destination house
```

A Google Maps link is generated for the full waypoint sequence. Total distance and estimated fuel cost are shown in the results panel.

### Distance formula

All distances are calculated with the **Haversine formula** on a sphere of radius 6 371 km, giving great-circle distances in kilometres.

---

## Features

- Inventory dashboard with material stock per house
- Optimal pickup route calculation (Nearest Neighbor + 2-opt)
- Map-based driver starting location picker (Leaflet)
- Fuel cost estimate per route
- Supplier fallback when stock is insufficient
- PDF inventory export
- Bulgarian / English language toggle
- Interactive map view with all houses plotted

---

## Map View

The **Map View** (sidebar → 🗺 Map View) displays all houses that have GPS coordinates plotted on an interactive OpenStreetMap.

### House name chips
Each house shows a permanent label above its pin:
- **Green chip** — house has remaining materials in stock
- **Dark chip** — house has no materials (empty warehouse)

### Clicking a pin
Opens a detailed popup card matching the dashboard view, showing:
- House name and location
- Start date and current construction phase
- All materials with quantity, unit, value, and a colour progress bar
- Remaining materials estimated value (total)

### Navigation behaviour
- The map fills the full screen area (below the header, right of the sidebar)
- On mobile the sidebar collapses and the map expands to full width
- The map auto-fits to show all houses when first opened
- Resizing the window or toggling the sidebar automatically recalculates the map size

---

## Repository Structure

```
tedhouse-logistics/
│
├── server.js                  # Express backend — all API routes, auth middleware,
│                              #   route optimization algorithm (Nearest Neighbor + 2-opt),
│                              #   session management (express-session + bcryptjs)
│
├── database.sql               # Full MySQL dump — run once to create all tables and
│                              #   seed initial data (houses, inventory, materials,
│                              #   suppliers, users)
│
├── package.json               # Node.js project metadata and dependency list
├── package-lock.json          # Exact dependency versions lock file
│
├── public/                    # Static files served directly by Express
│   │
│   ├── index.html             # Single-page application — the entire frontend lives here:
│   │                          #   dashboard view, new order view, map view, all modals,
│   │                          #   login screen, i18n (BG/EN), PDF export, route display
│   │
│   ├── map-picker.html        # Standalone Leaflet map page for picking a GPS location.
│   │                          #   Saves the chosen pin to localStorage and redirects back
│   │                          #   to index.html (used for driver start and house coords)
│   │
│   ├── leaflet.js             # Leaflet mapping library (bundled locally, no CDN needed)
│   ├── leaflet.css            # Leaflet default styles
│   ├── marker-icon.png        # Default map pin icon (1x)
│   ├── marker-icon-2x.png     # Default map pin icon (retina / 2x)
│   └── marker-shadow.png      # Map pin drop shadow
```

### Database Tables

| Table       | Purpose                                                      |
|-------------|--------------------------------------------------------------|
| `house`     | Construction sites — name, location, GPS coords, start date, current phase |
| `warehouse` | One warehouse per house, links house to its inventory        |
| `inventory` | Stock quantities — links warehouse + material + quantity     |
| `material`  | Material catalogue — name, unit, price per unit              |
| `supplier`  | Fallback suppliers with GPS coords for deficit orders        |
| `driver`    | Driver records (reserved for future use)                     |
| `users`     | Login accounts — username, bcrypt password hash, role        |
