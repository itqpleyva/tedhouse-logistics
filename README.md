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
