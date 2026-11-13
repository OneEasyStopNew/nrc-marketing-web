# DataTable

A BasicTable inside a Card with a toolbar above and a pager below.

Toolbar, left to right: search (260px), active filter chips, then the bulk-action group that appears only when rows are selected ("2 selected · Send pass · Move stage"), then the primary action.

Headers that sort show a chevron; one column sorts at a time. The selection column is 36px; a mixed checkbox in the header selects the page. Selected rows take `brand-wash`. The last column holds a 32px ghost "more" button for row actions.

Pager row: count left, page size and Pagination right. Empty results render EmptyState inside the card body.

Column order on the clinical side: code, stage, study, site, last contact, coordinator, attempts. Names appear only on the clinical side and only to roles that may see them.
