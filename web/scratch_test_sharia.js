const { isShariaCompliant } = require('./src/lib/shariaStocks');

console.log("isShariaCompliant('MAAL'):", isShariaCompliant('MAAL'));
console.log("isShariaCompliant('ACAMD'):", isShariaCompliant('ACAMD'));
console.log("isShariaCompliant('COSG'):", isShariaCompliant('COSG'));
console.log("isShariaCompliant('OCDI'):", isShariaCompliant('OCDI'));
