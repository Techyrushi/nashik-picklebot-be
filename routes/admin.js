const express = require("express");
const Court = require("../models/Court");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const auth = require("../middleware/auth");
const sendWhatsApp = require("../utils/sendWhatsApp");

const router = express.Router();

// Courts
router.get("/courts", auth, async (req, res) => {
  const courts = await Court.find();
  res.json(courts);
});
router.post("/courts", auth, async (req, res) => {
  const { name, price, type, status } = req.body;
  const c = new Court({ name, price, type, status });
  await c.save();
  res.json(c);
});
router.put("/courts/:id", auth, async (req, res) => {
  try {
    const { name, price, type, status } = req.body;
    const updatedCourt = await Court.findByIdAndUpdate(
      req.params.id,
      { name, price, type, status },
      { new: true }
    );
    
    if (!updatedCourt) {
      return res.status(404).json({ message: "Court not found" });
    }
    
    res.json(updatedCourt);
  } catch (error) {
    console.error("Error updating court:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.delete("/courts/:id", auth, async (req, res) => {
  await Court.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Slots
router.get("/slots", auth, async (req, res) => {
  const slots = await Slot.find();
  res.json(slots);
});
router.post("/slots", auth, async (req, res) => {
  const { time, price, status, date, courtId } = req.body;
  const s = new Slot({ time, price, status, date, courtId });
  await s.save();
  res.json(s);
});
router.put("/slots/:id", auth, async (req, res) => {
  try {
    const { time, price, status, date, courtId } = req.body;
    const updatedSlot = await Slot.findByIdAndUpdate(
      req.params.id,
      { time, price, status, date, courtId },
      { new: true }
    );
    
    if (!updatedSlot) {
      return res.status(404).json({ message: "Slot not found" });
    }
    
    res.json(updatedSlot);
  } catch (error) {
    console.error("Error updating slot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.delete("/slots/:id", auth, async (req, res) => {
  await Slot.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Check court availability
router.get("/availability", auth, async (req, res) => {
  try {
    const { date, slotId } = req.query;
    
    if (!date || !slotId) {
      return res.status(400).json({ message: "Date and slot ID are required" });
    }
    
    // Get all courts
    const courts = await Court.find({ status: "Active" });
    
    // Get the slot to check its time
    const slot = await Slot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }
    
    // Get current date and time
    const currentDate = new Date();
    const bookingDate = new Date(date);
    
    // Only consider bookings as booked if:
    // 1. The booking date is in the future, OR
    // 2. The booking date is today but the slot time hasn't passed yet
    let shouldCheckBookings = true;
    
    if (bookingDate < currentDate) {
      // If booking date is in the past, courts should be available
      shouldCheckBookings = false;
    } else if (bookingDate.toDateString() === currentDate.toDateString()) {
      // If booking date is today, check if the slot time has passed
      const slotTimeParts = slot.time.split(' - ')[1]; // Get end time (e.g., "08:00")
      if (slotTimeParts) {
        const [hours, minutes] = slotTimeParts.split(':').map(Number);
        const slotEndTime = new Date(currentDate);
        slotEndTime.setHours(hours, minutes, 0, 0);
        
        // If current time is after slot end time, courts should be available
        if (currentDate > slotEndTime) {
          shouldCheckBookings = false;
        }
      }
    }
    
    // Get all bookings for the specified date and slot if needed
    const bookings = shouldCheckBookings ? await Booking.find({ 
      date: date,
      slotId: slotId,
      status: { $in: ["confirmed", "pending_payment"] }
    }) : [];
    
    // Get list of already booked court IDs
    const bookedCourtIds = bookings.map(booking => booking.courtId.toString());
    
    // Calculate availability for each court
    const courtsAvailability = courts.map(court => {
      // Count bookings for this court
      const courtBookings = bookings.filter(b => b.courtId.toString() === court._id.toString());
      const availableCapacity = court.capacity - courtBookings.length;
      const isFullyBooked = courtBookings.length >= court.capacity;
      
      return {
        courtId: court._id,
        courtName: court.name,
        totalCapacity: court.capacity,
        bookedCapacity: courtBookings.length,
        availableCapacity: availableCapacity > 0 ? availableCapacity : 0,
        isAvailable: !isFullyBooked,
        isFullyBooked: isFullyBooked
      };
    });
    
    // Filter out fully booked courts if needed
    const availableCourts = courtsAvailability.filter(court => !court.isFullyBooked);
    
    res.json({ 
      courts: courtsAvailability,
      availableCourts: availableCourts,
      hasAvailability: availableCourts.length > 0
    });
  } catch (error) {
    console.error("Error checking availability:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Check slot availability
router.get("/slots/availability", auth, async (req, res) => {
  try {
    const { date, slotId } = req.query;
    
    if (!date || !slotId) {
      return res.status(400).json({ message: "Date and slot ID are required" });
    }
    
    // Get the slot
    const slot = await Slot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }
    
    // Get all courts
    const courts = await Court.find({ status: "Active" });
    
    // Get current date and time
    const currentDate = new Date();
    const bookingDate = new Date(date);
    
    // Only consider bookings as booked if:
    // 1. The booking date is in the future, OR
    // 2. The booking date is today but the slot time hasn't passed yet
    let shouldCheckBookings = true;
    
    if (bookingDate < currentDate) {
      // If booking date is in the past, courts should be available
      shouldCheckBookings = false;
    } else if (bookingDate.toDateString() === currentDate.toDateString()) {
      // If booking date is today, check if the slot time has passed
      const slotTimeParts = slot.time.split(' - ')[1]; // Get end time (e.g., "08:00")
      if (slotTimeParts) {
        const [hours, minutes] = slotTimeParts.split(':').map(Number);
        const slotEndTime = new Date(currentDate);
        slotEndTime.setHours(hours, minutes, 0, 0);
        
        // If current time is after slot end time, courts should be available
        if (currentDate > slotEndTime) {
          shouldCheckBookings = false;
        }
      }
    }
    
    // Get all bookings for this date and slot if needed
    const bookings = shouldCheckBookings ? await Booking.find({
      date: date,
      slotId: slotId,
      status: { $in: ["confirmed", "pending_payment"] }
    }) : [];
    
    // Get list of already booked court IDs
    const bookedCourtIds = bookings.map(booking => booking.courtId.toString());
    
    // Calculate total capacity and booked capacity
    const totalCapacity = courts.reduce((sum, court) => sum + (court.capacity || 2), 0);
    const bookedCapacity = bookings.length;
    const availableCapacity = totalCapacity - bookedCapacity;
    
    // Calculate availability for each court (for detailed view)
    const courtsAvailability = courts.map(court => {
      // Count bookings for this court
      const courtBookings = bookings.filter(b => b.courtId.toString() === court._id.toString());
      const courtAvailableCapacity = court.capacity - courtBookings.length;
      const isFullyBooked = courtBookings.length >= court.capacity;
      
      return {
        courtId: court._id,
        courtName: court.name,
        totalCapacity: court.capacity || 2,
        bookedCapacity: courtBookings.length,
        availableCapacity: courtAvailableCapacity > 0 ? courtAvailableCapacity : 0,
        isAvailable: !isFullyBooked,
        isFullyBooked: isFullyBooked
      };
    });
    
    // Filter out fully booked courts
    const availableCourts = courtsAvailability.filter(court => !court.isFullyBooked);
    
    res.json({
      slotId: slot._id,
      slotTime: slot.time,
      date: date,
      totalCapacity,
      bookedCapacity,
      availableCapacity,
      isAvailable: availableCapacity > 0,
      hasAvailableCourts: availableCourts.length > 0,
      courts: courtsAvailability,
      availableCourts: availableCourts
    });
  } catch (error) {
    console.error("Error checking slot availability:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bookings
router.get("/bookings", auth, async (req, res) => {
  const bookings = await Booking.find().sort({ createdAt: -1 });
  res.json(bookings);
});
router.post("/bookings/:id/sendMessage", auth, async (req, res) => {
  const { message } = req.body;
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ message: "Not found" });
  await sendWhatsApp(booking.whatsapp, message);
  res.json({ ok: true });
});

module.exports = router;
