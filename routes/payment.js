const express = require("express");
const Razorpay = require("razorpay");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const bodyParser = require("body-parser");
const sendWhatsApp = require("../utils/sendWhatsApp");
const path = require("path");

const router = express.Router();
router.use(bodyParser.json());

// Initialize Razorpay with fallback for testing
const razor = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_ROwggD6SO2W63d",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "9L6QHo5bRY4GMW3wacJgM9SJ",
});

// Serve payment page
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/payment.html"));
});

// Serve scan page
router.get("/scan", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/scan.html"));
});

router.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/privacy.html"));
});

router.get("/terms&conditions", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/terms.html"));
});

router.get("/logo", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/assets/myyvo_logo.png"));
});

// Serve receipt page
router.get("/receipt/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).send("Booking not found");

    res.sendFile(path.join(__dirname, "../public/receipt.html"));
  } catch (e) {
    res.status(500).send("Error retrieving receipt");
  }
});

// Get booking details for payment page
router.get("/booking/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    res.json({
      id: booking._id,
      date: booking.date,
      slot: booking.slot,
      court: booking.courtName,
      amount: booking.amount,
      status: booking.status,
      checkedIn: booking.checkedIn || false,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get receipt data
router.get("/receipt-data/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    res.json({
      id: booking._id,
      date: booking.date,
      slot: booking.slot,
      court: booking.courtName,
      amount: booking.amount,
      status: booking.status,
      paymentId: booking.paymentId,
      invoiceNumber: booking.invoiceNumber,
      createdAt: booking.createdAt,
      checkedIn: booking.checkedIn || false,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create Razorpay order
router.post("/create-order", async (req, res) => {
  const { bookingId, amount } = req.body;
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Use booking amount if available, fallback to provided amount
    const paymentAmount = booking.amount || amount || 0;

    // Ensure we have a valid amount
    if (!paymentAmount || isNaN(paymentAmount)) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    // Create Razorpay order (amount in smallest currency unit)
    const order = await razor.orders.create({
      amount: Math.round(paymentAmount * 100), // e.g., 200 CNY -> 20000 fen
      currency: "INR", // Using INR for Razorpay
      receipt: `booking_${bookingId}`,
      notes: {
        bookingId,
        date: booking.date,
        slot: booking.slot,
        court: booking.courtName,
      },
    });

    // Save order id with booking
    booking.razorpayOrderId = order.id;
    booking.paymentId = order.payment_id;
    await booking.save();

    res.json({
      order_id: order.id,
      currency: order.currency,
      amount: order.amount, // smallest currency unit (for Razorpay)
      key: process.env.RAZORPAY_KEY_ID, // Send key to frontend
      displayAmount: paymentAmount, // original amount for frontend display
      booking: {
        id: booking._id,
        date: booking.date,
        slot: booking.slot,
        court: booking.courtName,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Payment verification
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      bookingId,
    } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // Check if the court is still available before confirming
    // Get the slot to check its time
    const slot = await Slot.findById(booking.slotId);
    if (!slot) {
      return res.status(404).json({ error: "Slot not found" });
    }

    // Get current date and time
    const currentDate = new Date();
    const bookingDate = new Date(booking.date);

    // Only check for existing bookings if:
    // 1. The booking date is in the future, OR
    // 2. The booking date is today but the slot time hasn't passed yet
    let shouldCheckBookings = true;

    if (bookingDate < currentDate) {
      // If booking date is in the past, courts should be available
      shouldCheckBookings = false;
    } else if (bookingDate.toDateString() === currentDate.toDateString()) {
      // If booking date is today, check if the slot time has passed
      const slotTimeParts = slot.time.split(" - ")[1]; // Get end time (e.g., "08:00")
      if (slotTimeParts) {
        const [hours, minutes] = slotTimeParts.split(":").map(Number);
        const slotEndTime = new Date(currentDate);
        slotEndTime.setHours(hours, minutes, 0, 0);

        // If current time is after slot end time, courts should be available
        if (currentDate > slotEndTime) {
          shouldCheckBookings = false;
        }
      }
    }

    if (shouldCheckBookings) {
      const existingBookings = await Booking.find({
        date: booking.date,
        slotId: booking.slotId,
        courtId: booking.courtId,
        status: "confirmed",
        _id: { $ne: booking._id },
      });

      if (existingBookings.length > 0) {
        return res.status(409).json({
          error:
            "This court has already been booked for this time slot. Please choose another court or time slot.",
          courtUnavailable: true,
        });
      }
    }

    // Generate invoice number
    const invoiceNumber = "INV-" + Date.now().toString().substring(7);

    // In production: verify signature using razorpay_signature
    booking.status = "confirmed";
    booking.confirmedAt = new Date();
    booking.paymentId = razorpay_payment_id;
    booking.invoiceNumber = invoiceNumber;
    await booking.save();

    // Generate receipt URL
    const receiptUrl = `${
      process.env.BASE_URL || "http://localhost:4000"
    }/payment/receipt/${booking._id}?invoice=${invoiceNumber}`;

    // Send WhatsApp confirmation
    if (booking.whatsapp) {
      const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking._id}`;
      await sendWhatsApp(
        booking.whatsapp,
        `💼 Booking Confirmed!

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}

View your receipt: ${receiptUrl}

QR Code for check-in: ${qrCodeLink}

Thank you for booking with PicklePlay! Reply 'menu' to return to main menu.`
      );
    }

    res.json({
      success: true,
      booking: {
        id: booking._id,
        status: booking.status,
        date: booking.date,
        slot: booking.slot,
        court: booking.courtName,
        amount: booking.amount,
        paymentId: req.body.razorpay_payment_id,
        receiptUrl: receiptUrl,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check-in a player
router.post("/check-in/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.status !== "confirmed") {
      return res
        .status(400)
        .json({ error: "Only confirmed bookings can be checked in" });
    }

    if (booking.checkedIn) {
      return res.status(400).json({ error: "Player already checked in" });
    }

    booking.checkedIn = true;
    booking.checkedInTime = new Date();
    await booking.save();

    // Format check-in time for display
    const checkInTime = new Date(booking.checkedInTime).toLocaleString(
      "en-US",
      {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    );

    // Send notification to admin
    const adminWhatsApp = process.env.ADMIN_WHATSAPP;
    if (adminWhatsApp) {
      await sendWhatsApp(
        adminWhatsApp,
        `🎾 Player Check-In Alert

A player has just checked in:

📋 Booking Details:
- ID: ${booking._id}
- Court: ${booking.courtName}
- Date: ${booking.date}
- Time: ${booking.slot}
- Player: ${booking.whatsapp}
- Check-in Time: ${checkInTime}

This is an automated notification.`
      );
    }

    res.json({
      success: true,
      message: "Player checked in successfully",
      booking: {
        id: booking._id,
        date: booking.date,
        slot: booking.slot,
        court: booking.courtName,
        amount: booking.amount,
        status: booking.status,
        checkedIn: booking.checkedIn,
        checkedInTime: booking.checkedInTime,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancel booking
router.post("/cancel/:id", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.status === "confirmed") {
      return res
        .status(400)
        .json({ error: "Cannot cancel a confirmed booking" });
    }

    booking.status = "cancelled";
    await booking.save();

    // Optional WhatsApp notification
    if (booking.whatsapp) {
      await sendWhatsApp(
        booking.whatsapp,
        `❌ Booking Cancelled

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}

Your booking has been cancelled successfully.`
      );
    }

    res.json({ success: true, bookingId: booking._id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simple webhook (for Razorpay webhooks)
router.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    const payment = payload.payload?.payment?.entity;
    const bookingId = payment?.notes?.bookingId;

    if (bookingId) {
      const booking = await Booking.findById(bookingId);
      if (booking && booking.status !== "confirmed") {
        booking.status = "confirmed";
        booking.confirmedAt = new Date();
        booking.paymentId = payment.id;
        await booking.save();

        // Generate receipt URL
        const receiptUrl = `${
          process.env.BASE_URL || "http://localhost:4000"
        }/receipt/${booking._id}`;

        if (booking.whatsapp) {
          const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking._id}`;
          await sendWhatsApp(
            booking.whatsapp,
            `💼 Booking Confirmed!

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}

View your receipt: ${receiptUrl}

QR Code for check-in: ${qrCodeLink}

Thank you for booking with PicklePlay! Reply 'menu' to return to main menu.`
          );
        }
      }
    }
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
  res.sendStatus(200);
});

module.exports = router;
