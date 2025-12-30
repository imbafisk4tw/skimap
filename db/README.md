# Skigebiete Karte – DB Starter (Postgres + PostGIS)

## Quickstart (Windows, empfohlen)
### 1) DB starten (Docker Desktop)
1. Docker Desktop installieren
2. In diesem Ordner:
   ```bash
   docker compose up -d
   ```
3. Verbinden:
   - Host: `localhost`
   - Port: `5432`
   - DB: `skigebiete`
   - User: `skigebiete`
   - Password: `skigebiete`

### 2) Schema einspielen
Mit DBeaver oder psql:
```bash
psql "postgresql://skigebiete:skigebiete@localhost:5432/skigebiete" -f schema.sql
```

### 3) Import aus JSON
Python 3.10+:

```bash
pip install psycopg2-binary
python import_from_json.py --db-url "postgresql://skigebiete:skigebiete@localhost:5432/skigebiete" --resorts resorts.json
```

Optional Access-Points/Parkings:
```bash
python import_from_json.py --db-url "..." --resorts resorts.json --access-points access_points_candidates.json --parkings parkings_candidates.json
```

### 4) Export zurück für dein Frontend
```bash
python export_to_json.py --db-url "postgresql://skigebiete:skigebiete@localhost:5432/skigebiete" --out-dir ./export
```

## Tooling
- DBeaver: DB-GUI + ER-Diagramm
- QGIS: Access-Points/Parkplätze visuell editieren (Postgres Layer)
