require('dotenv').config();
const app = require('./src/index.js');
process.on('uncaughtException', err => {
    console.error('FATAL UNCAUGHT:', err);
    process.exit(1);
});
process.on('unhandledRejection', err => {
    console.error('FATAL REJECTION:', err);
    process.exit(1);
});
setTimeout(() => {
    console.log("Alive after 2 seconds");
}, 2000);
