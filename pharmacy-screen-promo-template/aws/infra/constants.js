"use strict";

// Shared by the stack, the Lambda environment and the seed script: the key
// prefix every record has in the DynamoDB table (the AWS counterpart of
// PS_FIRESTORE_ROOT).
module.exports = { STORE_ROOT: "pharmacyScreen" };
