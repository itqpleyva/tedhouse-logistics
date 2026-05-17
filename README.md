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

## Features

- Inventory dashboard with material stock per house
- Optimal pickup route calculation (Nearest Neighbor + 2-opt)
- Map-based driver starting location picker (Leaflet)
- Fuel cost estimate per route
- Supplier fallback when stock is insufficient
- PDF inventory export
- Bulgarian / English language toggle
