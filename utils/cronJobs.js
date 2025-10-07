const cron = require("node-cron");
const Booking = require("../models/Booking");
const sendWhatsApp = require("./sendWhatsApp");

function startCronJobs() {
  // run every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try {
      const now = new Date();
      const bookings = await Booking.find({ status: "confirmed" });
      for (const booking of bookings) {
        // slot expected like "06:00 - 07:00"; take start time
        const start = booking.slot ? booking.slot.split('-')[0].trim() : "00:00";
        const bookingDateTime = new Date(`${booking.date}T${start}:00`);
        const diffHrs = (bookingDateTime - now) / (1000 * 60 * 60);
        
        // 24-Hour Reminder
        if (Math.abs(diffHrs - 24) < 0.3 && !booking.reminded24h) {
          const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking._id}`;
          await sendWhatsApp(booking.whatsapp, 
`💿 Reminder: Your booking is tomorrow!

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}
QR Code: ${qrCodeLink}

We look forward to seeing you!`);
          
          booking.reminded24h = true;
          await booking.save();
        }
        
        // 1-Hour Reminder
        if (Math.abs(diffHrs - 1) < 0.3 && !booking.reminded1h) {
          await sendWhatsApp(booking.whatsapp, 
`🌀 Reminder: Your pickleball booking starts in 1 hour.

Booking ID: ${booking._id}
Court: ${booking.courtName}
Time: ${booking.slot}
Contact info: +91-9876543210

Please arrive 10 minutes early for check-in.`);
          
          booking.reminded1h = true;
          await booking.save();
        }
      }
      
      // Clean up expired bookings (optional)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      // Update status of expired pending_payment bookings
      await Booking.updateMany(
        { 
          date: { $lt: yesterdayStr },
          status: "pending_payment"
        },
        {
          $set: { status: "expired" }
        }
      );
      
    } catch (err) {
      console.error("Cron job error:", err);
    }
  });
}

module.exports = startCronJobs;
