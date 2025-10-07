const mongoose = require("mongoose");
const BookingSchema = new mongoose.Schema({
  whatsapp: String,
  date: String, // YYYY-MM-DD
  slot: String,
  slotId: { type: mongoose.Schema.Types.ObjectId, ref: "Slot" },
  courtName: String,
  courtId: { type: mongoose.Schema.Types.ObjectId, ref: "Court" },
  amount: Number,
  razorpayOrderId: String,
  paymentId: String,
  invoiceNumber: String,
  status: { type: String, enum: ["pending_payment", "confirmed", "cancelled"], default: "pending_payment" },
  reminded24h: { type: Boolean, default: false },
  reminded1h: { type: Boolean, default: false },
  confirmedAt: Date,
  checkedIn: { type: Boolean, default: false },
  checkedInTime: Date
}, { timestamps: true });
module.exports = mongoose.model("Booking", BookingSchema);
