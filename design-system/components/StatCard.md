# StatCard

A Card with the `stat` layout: caption in `text-faint`, value in the `stat` mono style (28px, tabular), one line of delta. Deltas colour by meaning, not by sign: `done` when better, `blocked` when worse (a rising cost per enrolled is red).

The regulatory stat (border and value in `regulatory`) is reserved for the adverse event clock and audit counts. Four tiles per row on desktop, two on tablet. Never a sparkline inside a stat; put the trend in a LineChart below.
