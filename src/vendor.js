// Runs the demo vendor agents as their own service. Optional: the main server already mounts
// them at /vendors. To use this, start it and set VENDOR_BASE_URL=http://localhost:4000/vendors.
const express = require('express');
const { vendorRouter } = require('./vendors');

const port = Number(process.env.VENDOR_PORT) || 4000;
const app = express();
app.use('/vendors', vendorRouter);
app.listen(port, () => console.log(`Vendor agents listening at http://localhost:${port}/vendors`));
