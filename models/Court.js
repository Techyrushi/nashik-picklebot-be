const mongoose = require("mongoose");
const CourtSchema = new mongoose.Schema({
  name: String,
  price: Number,
  type: { type: String, enum: ["Indoor", "Outdoor"], default: "Indoor" },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  capacity: { type: Number, default: 2 }
});
module.exports = mongoose.model("Court", CourtSchema);
