# Frontend performance notes

Measured with the SANFAANI Vite production build on 2026-08-14.

| Chunk / package | Minified size | Why it exists | Decision |
| --- | ---: | --- | --- |
| Main application | 179.70 kB | Operational shell and the frequently used staff workflows | Keep in the fast operational path |
| React runtime | 185.86 kB | React, React DOM, and scheduler | Stable vendor cache chunk |
| Supabase | 216.82 kB | Authentication and session restoration | Stable vendor cache chunk; required |
| TanStack Query | 35.90 kB | API cache, mutations, and invalidation | Stable vendor cache chunk; required |
| Admin analytics / Recharts | 400.76 kB | Management charts | Route-lazy; never loaded by staff/customer dashboards |
| jsPDF | 386.39 kB | Structured receipt PDF generation | Action-lazy; only loaded after Download PDF |
| html2canvas | 201.04 kB | Transitive jsPDF optional capability | Kept inside the action-lazy PDF graph |
| QR encoder | 25.78 kB | Secure receipt claim QR | Receipt-detail lazy graph only |
| Camera scanner | 1.20 kB | Native BarcodeDetector camera flow | Loaded only when Scan Claim is opened |

The original main chunk was 630.81 kB minified (176.68 kB gzip) and triggered Vite's 500 kB warning. After route/action splitting and stable vendor chunks, the main application chunk is 179.70 kB (45.53 kB gzip); no production chunk warning remains.

Query defaults use a 30-second stale time, one retry, no mutation retry, and no automatic window-focus refetch. Historical transactions and receipts use a 60-second stale time and 50-row server pagination. Operational charging and capacity queries retain the shorter default because they represent live floor state.
