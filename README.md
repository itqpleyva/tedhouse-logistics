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

Open MySQL and run the following:

```sql
CREATE DATABASE `teodor-logistica`;
USE `teodor-logistica`;

CREATE TABLE house (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  location VARCHAR(255),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7)
);

CREATE TABLE warehouse (
  id INT AUTO_INCREMENT PRIMARY KEY,
  house_id INT,
  FOREIGN KEY (house_id) REFERENCES house(id)
);

CREATE TABLE material (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  unit VARCHAR(50),
  price DECIMAL(10,2)
);

CREATE TABLE inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT,
  material_id INT,
  quantity DECIMAL(10,2),
  FOREIGN KEY (warehouse_id) REFERENCES warehouse(id),
  FOREIGN KEY (material_id) REFERENCES material(id)
);

CREATE TABLE supplier (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  location VARCHAR(255),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7)
);
```

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
