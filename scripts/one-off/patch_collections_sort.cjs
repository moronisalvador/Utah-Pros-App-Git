// node patch_collections_sort.cjs
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, 'src/pages/Collections.jsx');
let src = fs.readFileSync(file, 'utf8');

// 1. Add missing sort cases to the switch statement
src = src.replace(
  `        case 'client':     av = a.insured_name || '';    bv = b.insured_name || ''; break;
        default:           av = getBalances(a).balance;  bv = getBalances(b).balance;`,
  `        case 'client':     av = a.insured_name || '';      bv = b.insured_name || '';      break;
        case 'insurance':  av = a.insurance_company || ''; bv = b.insurance_company || ''; break;
        case 'phase':      av = a.phase || '';             bv = b.phase || '';             break;
        case 'collected':  av = a.collected_value || 0;   bv = b.collected_value || 0;   break;
        case 'status':     av = a.ar_status || '';         bv = b.ar_status || '';         break;
        default:           av = getBalances(a).balance;   bv = getBalances(b).balance;`
);

// 2. Make "Insurance / Carrier" header sortable
src = src.replace(
  `                    <th>Insurance / Carrier</th>`,
  `                    <th><SortBtn label="Insurance" col="insurance" current={sortBy} dir={sortDir} onSort={toggleSort} /></th>`
);

// 3. Make "Phase" header sortable
src = src.replace(
  `                    <th>Phase</th>`,
  `                    <th><SortBtn label="Phase" col="phase" current={sortBy} dir={sortDir} onSort={toggleSort} /></th>`
);

// 4. Make "Collected" header sortable
src = src.replace(
  `                    <th className="ar-th-num">Collected</th>`,
  `                    <th className="ar-th-num"><SortBtn label="Collected" col="collected" current={sortBy} dir={sortDir} onSort={toggleSort} /></th>`
);

// 5. Make "Status" header sortable
src = src.replace(
  `                    <th style={{ width: 120 }}>Status</th>`,
  `                    <th style={{ width: 120 }}><SortBtn label="Status" col="status" current={sortBy} dir={sortDir} onSort={toggleSort} /></th>`
);

fs.writeFileSync(file, src, 'utf8');
console.log('Done — Collections now has sortable headers on all columns.');
