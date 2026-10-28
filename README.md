# LabSync — Advanced Java Lab Project

A working lab resource booking and issue-tracking web application. Its visual direction takes cues from the supplied reference video: dark teal gradients, warm ivory surfaces, strong editorial typography, compact status cards, and restrained coral accents.

## What works

- Student and administrator demo roles.
- Browse/search/filter lab equipment.
- Create a resource booking with date/time validation.
- Prevent overlapping bookings for the same resource and time slot.
- Block bookings for equipment in maintenance or with an unresolved issue.
- Cancel confirmed bookings.
- Report a maintenance issue with severity and description.
- Automatically flag the affected resource for maintenance after an issue is reported.
- Administrator inventory controls: add resources and change operational status.
- Administrator issue queue: move a ticket between Open, In repair, and Resolved.
- Resolving the final open issue restores a resource to Available unless it has been manually marked Unavailable.
- Demo mode saves data in browser local storage. The Java backend mode persists data through JDBC.

## Run the interactive demo immediately

No database, Maven, or server is required to explore the UI.

1. Extract the ZIP.
2. Open `src/main/webapp/index.html` in Chrome or Edge.
3. Click **Open workspace** or choose a demo role from **Sign in**.

Demo roles:

- Student: `student@labsync.local` / `student123`
- Administrator: `admin@labsync.local` / `admin123`

The file-based demo stores edits in local storage for the current browser profile. Use the **Sign out** icon in the workspace sidebar to return to the landing page. Use **Reset demo data** in the reset instructions below if you want a clean start.

### Reset local demo data

Open the browser developer console on the demo page and run:

```js
localStorage.removeItem('labsync-demo-state-v1');
location.reload();
```

## Run the Java Servlet + JDBC backend

### Requirements

- JDK 11 or later
- Maven 3.8+
- Apache Tomcat 9.x (this project uses `javax.servlet`, not the Jakarta namespace from Tomcat 10+)

### Build and deploy

From this project folder:

```bash
mvn clean package
```

The WAR file will be created at `target/LabSync.war`. Copy it to Tomcat's `webapps` folder and start Tomcat. Open:

`http://localhost:8080/LabSync/`

The application initializes the schema and demo records on first startup. With default settings, it uses an H2 file database at `./data/labsync` relative to the Java server's working directory; you do not need to install MySQL just to run the project.

On the deployed JSP page, the browser automatically uses the Java Servlet API. It does **not** silently switch to local-storage demo mode when the backend is reachable but returns an application error.

### Optional: configure MySQL instead of H2

1. Install MySQL and create the database with `database/mysql-create.sql`.
2. Set these environment variables **before starting Tomcat**.

Windows PowerShell:

```powershell
$env:LABSYNC_DB_URL = "jdbc:mysql://localhost:3306/labsync?useSSL=false&serverTimezone=UTC"
$env:LABSYNC_DB_USER = "root"
$env:LABSYNC_DB_PASSWORD = "YOUR_MYSQL_PASSWORD"
```

macOS/Linux shell:

```bash
export LABSYNC_DB_URL='jdbc:mysql://localhost:3306/labsync?useSSL=false&serverTimezone=UTC'
export LABSYNC_DB_USER='root'
export LABSYNC_DB_PASSWORD='YOUR_MYSQL_PASSWORD'
```

Then start Tomcat from that same environment. The app creates the tables and demo rows. Never commit real database credentials into the project.

## Architecture

```text
Browser (HTML / CSS / JavaScript)
             |
             | HTTP + JSON
             v
        AuthFilter
             |
             v
        ApiServlet (Controller)
             |
             v
       JDBC / PreparedStatement
             |
             v
       H2 (default) / MySQL
```

- **View:** `index.jsp` (with a matching `index.html` for offline demo mode), `css/styles.css`
- **Client interactions:** `js/app.js`
- **Controller/API:** `ApiServlet.java`
- **Authentication filter:** `AuthFilter.java`
- **Database setup and seed records:** `Database.java`
- **Password hashing:** `PasswordUtil.java` using PBKDF2WithHmacSHA256

This is a small lab-project implementation, not a production deployment. Before real deployment, add CSRF protection, stricter validation/rate limiting, security headers, deployment-managed secrets, audit logging, and a proper connection pool.

## API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/status` | Backend health check |
| GET | `/api/auth/me` | Current session user |
| POST | `/api/auth/login` | Sign in and create HTTP session |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/resources` | List active resources |
| POST | `/api/resources` | Add a resource (admin) |
| POST | `/api/resources/{id}/status` | Set resource status (admin) |
| GET | `/api/bookings` | List the current user's bookings; all bookings for admin |
| POST | `/api/bookings` | Create booking with conflict checks |
| POST | `/api/bookings/{id}/cancel` | Cancel a booking |
| GET | `/api/issues` | List the current user's reports; all reports for admin |
| POST | `/api/issues` | Report equipment issue |
| POST | `/api/issues/{id}/status` | Update issue status (admin) |
| GET | `/api/admin/summary` | Admin dashboard counts |

## Project structure

```text
LabSync_Advanced_Java/
├── pom.xml
├── README.md
├── database/
│   └── mysql-create.sql
├── docs/
│   └── PROJECT_NOTES.md
└── src/main/
    ├── java/in/jecrc/labsync/
    │   ├── ApiServlet.java
    │   ├── AuthFilter.java
    │   ├── Database.java
    │   └── PasswordUtil.java
    └── webapp/
        ├── index.html
        ├── index.jsp
        ├── css/styles.css
        ├── js/app.js
        └── WEB-INF/web.xml
```
