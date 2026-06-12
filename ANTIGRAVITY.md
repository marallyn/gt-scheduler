# GT Degree Planner (gt-scheduler)

A web-based tool for planning a 4-year degree schedule at Georgia Tech. It handles AP/DE credit mapping, interactive drag-and-drop scheduling, dynamic degree audits, course catalog imports, and year-by-year planning.

## Features
- **Flexible Schedule Storage:** Schedules are saved locally in the browser's `localStorage` and persist even when switching majors, allowing you to audit the same plan against different degree requirements.
- **Dynamic Degree Audit:** Automatically audits completed/planned courses against major requirements, showing checkmarks for satisfied slots and listing unused courses.
- **Drag-and-Drop Scheduling:** Drag courses directly from the requirements checklist or catalog search results into semesters using [SortableJS](https://sortablejs.github.io/Sortable/).
- **AP / Dual Enrollment Credit Mapper:** An interactive side panel (`ap-credits.html`) allows you to input your AP scores and Dual Enrollment credits to automatically map them to Georgia Tech course codes.
- **Dynamic Course Catalog Fetcher:** A Python command-line utility (`update_courses.py`) downloads course details directly from the official Georgia Tech catalog and merges them into the local database.
- **Integrated Utilities Menu:** Exposes catalog fetching directly inside the browser using a custom server. You can import any subject prefix (e.g. `CS`, `MATH`, `APPH`, `LCC`) and hot-reload the catalog database dynamically without refreshing the page.
- **Clean Responsive Styling:** Beautiful Georgia Tech themed design (Gold, Navy, and White) with collapsible requirement cards, exact course search placeholders, and full mobile-friendly layouts.

## Architecture
- **Frontend:** HTML5, CSS3, JavaScript (ES6+).
- **Libraries:** [SortableJS](https://sortablejs.github.io/Sortable/) for drag-and-drop lists.
- **Local Server & API:** [server.py](server.py) serves static files and exposes a Python API `/api/fetch-subject` to trigger the web scraping scripts.
- **Data Model:** Centralized in `data.js` containing catalogs, AP mappings, and curriculum requirements.

## File Structure
- `index.html`: Main planner layout (checklist side pane, calendar grid).
- `ap-credits.html`: AP Exam Score and Dual Enrollment credit configuration manager.
- `style.css`: Modern styling tokens, layout grids, animations, and modal designs.
- `script.js`: Core planner state manager, Sortable binding, and DOM event wiring.
- `data.js`: Unified course database, AP equivalencies, and major curriculum requirements.
- `update_courses.py`: Scraping script that extracts course data from `https://catalog.gatech.edu` and merges it into `data.js`.
- `server.py`: Custom HTTP server that integrates the static front-end with the catalog-scraping script.
- `ANTIGRAVITY.md`: Project documentation and architecture guide.

## Running the Project
To start the degree planner locally with the custom API integration:
```bash
python3 server.py 8085
```
Then open **[http://localhost:8085](http://localhost:8085)** in your web browser.

## Major Curriculums Supported
- **Biology (B.S.)**
- **Neuroscience (B.S.)**
- **Biomedical Engineering (B.S.)**
