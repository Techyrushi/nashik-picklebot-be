const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const Court = require("../models/Court");
const sendWhatsApp = require("../utils/sendWhatsApp");
const { nanoid } = require("nanoid");

const router = express.Router();

// Helper function to generate available dates for next 7 days
function getNextSevenDays() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const formattedDate = date.toISOString().split('T')[0];
    const displayDate = `${date.getDate()} ${date.toLocaleString('default', { month: 'short' })}`;
    dates.push({ value: formattedDate, display: displayDate });
  }
  return dates;
}

// Twilio webhook expects x-www-form-urlencoded; our main server passes parsed body
router.post("/", async (req, res) => {
  try {
    const from = req.body.From;
    const body = (req.body.Body || "").trim().toLowerCase();
    
    // Extract user name from WhatsApp number if available
    const userName = from.split('+')[1] || "there";
    
    // very simple session store in-memory (for demo). In prod persist to DB or redis.
    router.sessions = router.sessions || {};
    const sessions = router.sessions;
    
    // Handle initial greeting or restart
    if (body === "hi" || body === "hello" || body === "restart") {
      delete sessions[from];
      sessions[from] = { stage: "menu" };
      await sendWhatsApp(from,
`💶 *Welcome to PicklePlay Court Booking!* 🎾

Hello +${userName}, please select an option:

*1️⃣ [Book Court]* - Reserve your court now
*2️⃣ [My Bookings]* - View your reservations
*3️⃣ [Check Availability]* - See open slots
*4️⃣ [Pricing & Rules]* - View our rates
*5️⃣ [Contact Admin]* - Get support

Reply with a number or option name.`);
      return res.end();
    }
    
    if (!sessions[from]) {
      sessions[from] = { stage: "menu" };
      await sendWhatsApp(from,
`💶 *Welcome to PicklePlay Court Booking!* 🎾

Hello ${userName}, please select an option:

*1️⃣ [Book Court]* - Reserve your court now
*2️⃣ [My Bookings]* - View your reservations
*3️⃣ [Check Availability]* - See open slots
*4️⃣ [Pricing & Rules]* - View our rates
*5️⃣ [Contact Admin]* - Get support

Reply with a number or option name.`);
      return res.end();
    }
  
  const session = sessions[from];

  if (session.stage === "menu") {
    if (body === "1" || body.includes("book")) {
      session.stage = "choose_date";
      const availableDates = getNextSevenDays();
      let dateOptions = "🗓️ *Select a Booking Date:*\n\n";
      availableDates.forEach((date, i) => {
        dateOptions += `*${i+1}️⃣ [${date.display}]*\n`;
      });
      dateOptions += "\nReply with the date number.";
      session.availableDates = availableDates;
      await sendWhatsApp(from, dateOptions);
      return res.end();
    } else if (body === "2" || body.includes("my booking")) {
      const bookings = await Booking.find({ whatsapp: from });
      if (!bookings.length) {
        await sendWhatsApp(from, "📭 *You have no bookings.*\n\nReply with 'menu' to return to main menu.");
      } else {
        let text = "📚 *Your Bookings:*\n\n";
        bookings.forEach((b, i) => {
          text += `*Booking #${i+1}*\n`;
          text += `🆔 ID: ${b._id}\n`;
          text += `📅 Date: ${b.date}\n`;
          text += `⏰ Time: ${b.slot}\n`;
          text += `🎾 Court: ${b.courtName}\n`;
          text += `📊 Status: ${b.status}\n\n`;
        });
        text += "Reply with 'menu' to return to main menu.";
        await sendWhatsApp(from, text);
      }
      return res.end();
    } else if (body === "3" || body.includes("availability")) {
      session.stage = "check_availability_date";
      const availableDates = getNextSevenDays();
      let dateOptions = "🔍 *Check Availability For:*\n\n";
      availableDates.forEach((date, i) => {
        dateOptions += `*${i+1}️⃣ [${date.display}]*\n`;
      });
      dateOptions += "\nReply with the date number.";
      session.availableDates = availableDates;
      await sendWhatsApp(from, dateOptions);
      return res.end();
    } else if (body === "4" || body.includes("pricing") || body.includes("rules")) {
      await sendWhatsApp(from, 
`💰 *PicklePlay Pricing & Rules*

*Court Pricing:*
• Standard Court: ₹300/hour
• Indoor Court: ₹350/hour
• Premium Court: ₹400/hour

⚠️ *Booking Rules:*
• Bookings must be made at least 2 hours in advance
• Cancellations with full refund allowed up to 24 hours before
• Late cancellations incur a 50% fee
• No-shows are charged full amount
• Please arrive 10 minutes before your slot

Reply with 'menu' to return to main menu.`);
      return res.end();
    } else if (body === "5" || body.includes("contact") || body.includes("admin")) {
      await sendWhatsApp(from, 
`📞 *Contact PicklePlay Admin*

For urgent matters:
📱 Call: +91-9876543210

For general inquiries:
📧 Email: admin@pickleplay.com

⏰ *Operating Hours:*
Monday-Friday: 9:00 AM - 6:00 PM
Weekends: 10:00 AM - 4:00 PM

Reply with 'menu' to return to main menu.`);
      return res.end();
    } else if (body === "menu") {
      await sendWhatsApp(from,
`💶 *PicklePlay Court Booking* 🎾

*1️⃣ [Book Court]* - Reserve your court now
*2️⃣ [My Bookings]* - View your reservations
*3️⃣ [Check Availability]* - See open slots
*4️⃣ [Pricing & Rules]* - View our rates
*5️⃣ [Contact Admin]* - Get support

Reply with a number or option name.`);
      return res.end();
    } else {
      await sendWhatsApp(from, "❌ *Invalid selection*\n\nPlease reply with a number from 1-5 or type 'menu' to see options.");
      return res.end();
    }
  }

  if (session.stage === "check_availability_date") {
    const idx = parseInt(body);
    const availableDates = session.availableDates || [];
    if (isNaN(idx) || idx < 1 || idx > availableDates.length) {
      await sendWhatsApp(from, "❌ Invalid date selection. Please reply with a number from the list.");
      return res.end();
    }
    
    const selectedDate = availableDates[idx-1].value;
    // Get available slots for this date
    const slots = await Slot.find();
    const bookings = await Booking.find({ 
      date: selectedDate,
      status: { $in: ["confirmed", "pending_payment"] }
    });
    
    let availabilityMsg = `💸 Available time slots for ${availableDates[idx-1].display}:\n\n`;
    
    if (!slots.length) {
      availabilityMsg = "No time slots configured for this date. Please try another date or contact admin.";
    } else {
      // Get all courts first
      const allCourts = await Court.find();
      
      // Get current date and time
      const currentDate = new Date();
      const selectedDateObj = new Date(selectedDate);
      const isSameDay = selectedDateObj.toDateString() === currentDate.toDateString();
      
      // Filter slots based on 2-hour buffer if it's today
      let availableSlots = slots;
      if (isSameDay) {
        availableSlots = slots.filter(slot => {
          try {
            // Extract the start time part (e.g., "6.00 PM" from "6.00 PM - 7.00 PM")
            const timeParts = slot.time.split('-');
            if (timeParts.length < 2) return true; // Keep slot if format is unexpected
            
            const startTimeStr = timeParts[0].trim();
            
            // Create a date object for today with the slot's start time
            const slotStartTime = new Date(currentDate);
            
            // Handle time format with periods (6.00 PM) or colons (6:00 PM)
            let timeStr = startTimeStr.replace('.', ':');
            
            // Parse the time string into hours and minutes
            const isPM = timeStr.toLowerCase().includes('pm');
            const isAM = timeStr.toLowerCase().includes('am');
            
            // Remove AM/PM indicator and trim
            timeStr = timeStr.replace(/am|pm/i, '').trim();
            
            // Extract hours and minutes
            const [hours, minutes] = timeStr.split(':').map(Number);
            
            // Adjust hours for PM (add 12 to hours less than 12)
            let adjustedHours = hours;
            if (isPM && hours < 12) adjustedHours += 12;
            if (isAM && hours === 12) adjustedHours = 0;
            
            // Set the time on our date object
            slotStartTime.setHours(adjustedHours, minutes, 0, 0);
            
            // Add 2-hour buffer to current time
            const bufferTime = new Date(currentDate);
            bufferTime.setHours(bufferTime.getHours() + 2);
            
            // Keep slot if start time is at least 2 hours in the future
            return slotStartTime > bufferTime;
          } catch (error) {
            console.error(`Error parsing time for slot ${slot.time}:`, error);
            return true; // Keep slot if we can't parse the time
          }
        });
      }
      
      if (availableSlots.length === 0) {
        availabilityMsg = "No available time slots for today. Please select another date.";
      } else {
        // Process each available slot
        for (const slot of availableSlots) {
          // Get all bookings for this slot
          const slotBookings = bookings.filter(b => b.slot === slot.time);
          
          // Create a map of courts with their booking status
          const courtAvailability = {};
          allCourts.forEach(court => {
            courtAvailability[court._id.toString()] = {
              court: court,
              isBooked: false
            };
          });
          
          // Mark courts as booked
          slotBookings.forEach(booking => {
            if (courtAvailability[booking.courtId.toString()]) {
              courtAvailability[booking.courtId.toString()].isBooked = true;
            }
          });
          
          // Count available courts
          const availableCourts = Object.values(courtAvailability)
            .filter(item => !item.isBooked)
            .map(item => item.court);
          
          // Only show slots that have available courts
          if (availableCourts.length > 0) {
            availabilityMsg += `${slot.time}: ${availableCourts.length} courts available\n`;
          }
        }
      }
      
      // Check if we have any slots with available courts
      if (!availabilityMsg.includes("courts available")) {
        availabilityMsg = "No available time slots for this date. Please select another date.";
      }
    }
    
    availabilityMsg += "\nReply with 'book' to make a booking or 'menu' to return to main menu.";
    await sendWhatsApp(from, availabilityMsg);
    session.stage = "after_availability";
    return res.end();
  }
  
  if (session.stage === "after_availability") {
    if (body === "book" || body.includes("book")) {
      session.stage = "choose_date";
      const availableDates = getNextSevenDays();
      let dateOptions = "💷 *Please select a date for your booking:*\n\n";
      availableDates.forEach((date, i) => {
        dateOptions += `*${i+1}️⃣ [${date.display}]*\n`;
      });
      dateOptions += "\nReply with the date number.";
      session.availableDates = availableDates;
      await sendWhatsApp(from, dateOptions);
      return res.end();
    } else if (body === "menu") {
      session.stage = "menu";
      await sendWhatsApp(from,
`1. Book Court
2. My Bookings
3. Check Availability
4. Pricing & Rules
5. Contact Admin

Reply with the number or option name.`);
      return res.end();
    } else {
      await sendWhatsApp(from, "Please reply with 'book' to make a booking or 'menu' to return to main menu.");
      return res.end();
    }
  }

  if (session.stage === "choose_date") {
    const idx = parseInt(body);
    const availableDates = session.availableDates || [];
    
    if (isNaN(idx) || idx < 1 || idx > availableDates.length) {
      await sendWhatsApp(from, "❌ Invalid date selection. Please reply with a number from the list.");
      return res.end();
    }
    
    const selectedDate = availableDates[idx-1].value;
    session.draft = { date: selectedDate };
    
    const slots = await Slot.find();
    if (!slots.length) {
      await sendWhatsApp(from, "No slots configured. Contact admin.");
      delete sessions[from];
      return res.end();
    }
    
    // Filter out past time slots if the selected date is today
    const currentDate = new Date();
    const bookingDate = new Date(selectedDate);
    let availableSlots = [...slots];
    
    if (bookingDate.toDateString() === currentDate.toDateString()) {
      // If booking is for today, filter out past time slots and apply 2-hour buffer
       availableSlots = slots.filter(slot => {
         try {
           // Extract the start time part (e.g., "6.00 PM" from "6.00 PM - 7.00 PM")
           const timeParts = slot.time.split('-');
           if (timeParts.length < 2) return true; // Keep slot if format is unexpected
           
           const startTimeStr = timeParts[0].trim();
           
           // Create a date object for today with the slot's start time
           const slotStartTime = new Date(currentDate);
           
           // Handle time format with periods (6.00 PM) or colons (6:00 PM)
           let timeStr = startTimeStr.replace('.', ':');
           
           // Parse the time string into hours and minutes
           const isPM = timeStr.toLowerCase().includes('pm');
           const isAM = timeStr.toLowerCase().includes('am');
           
           // Remove AM/PM indicator and trim
           timeStr = timeStr.replace(/am|pm/i, '').trim();
           
           // Extract hours and minutes
           const [hours, minutes] = timeStr.split(':').map(Number);
           
           // Adjust hours for PM (add 12 to hours less than 12)
           let adjustedHours = hours;
           if (isPM && hours < 12) adjustedHours += 12;
           if (isAM && hours === 12) adjustedHours = 0;
           
           // Set the time on our date object
           slotStartTime.setHours(adjustedHours, minutes, 0, 0);
           
           // Add 2-hour buffer to current time
           const bufferTime = new Date(currentDate);
           bufferTime.setHours(bufferTime.getHours() + 2);
           
           // Keep slot if start time is at least 2 hours in the future
           return slotStartTime > bufferTime;
         } catch (error) {
           console.error(`Error parsing time for slot ${slot.time}:`, error);
           return true; // Keep slot if we can't parse the time
         }
       });
    }
    
    if (!availableSlots.length) {
      await sendWhatsApp(from, "No available time slots for today. Please select another date.");
      session.stage = "choose_date";
      return res.end();
    }
    
    let msg = "⏰ Available time slots for " + availableDates[idx-1].display + ":\n\n";
    availableSlots.forEach((s,i)=> msg += `${i+1}. ${s.time} \n`);
    msg += "\nReply with the slot number.";
    session.slots = availableSlots;
    session.stage = "choose_slot";
    await sendWhatsApp(from, msg);
    return res.end();
  }

  if (session.stage === "choose_slot") {
    const idx = parseInt(body);
    const slots = session.slots || [];
    if (isNaN(idx) || idx<1 || idx>slots.length) {
      await sendWhatsApp(from, "❌ Invalid slot. Reply with the slot number.");
      return res.end();
    }
    const slot = slots[idx-1];
    session.draft.slot = slot.time;
    session.draft.slotId = slot._id;
    
    // Get current date and time
    const currentDate = new Date();
    const bookingDate = new Date(session.draft.date);
    
    // Only check for existing bookings if:
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
    
    // Check for already booked courts in this slot if needed
    const bookedCourts = shouldCheckBookings ? await Booking.find({
      date: session.draft.date,
      slot: session.draft.slot,
      status: { $in: ["confirmed", "pending_payment"] }
    }).select('courtId') : [];
    
    const bookedCourtIds = bookedCourts.map(b => b.courtId.toString());
    
    // Get available courts
    const courts = await Court.find({
      _id: { $nin: bookedCourtIds }
    });
    
    if (!courts.length) {
      await sendWhatsApp(from, "No courts available for this time slot. Please select another time slot.");
      session.stage = "choose_slot";
      return res.end();
    }
    
    let msg = "🎾 Available courts for " + session.draft.date + " – " + session.draft.slot + ":\n\n";
    courts.forEach((c,i)=> {
      const courtType = c.indoor ? " (Indoor)" : "";
      msg += `${i+1}. ${c.name} (₹${c.price || '300'}${courtType})\n`;
    });
    session.courts = courts;
    session.stage = "choose_court";
    await sendWhatsApp(from, msg);
    return res.end();
  }

  if (session.stage === "choose_court") {
    const idx = parseInt(body);
    const courts = session.courts || [];
    if (isNaN(idx) || idx<1 || idx>courts.length) {
      await sendWhatsApp(from, "❌ Invalid court. Reply with court number.");
      return res.end();
    }
    const court = courts[idx-1];
    session.draft.courtId = court._id;
    session.draft.courtName = court.name;
    session.draft.amount = court.price || 300;
    
    // Show booking summary before creating
    const summary = 
`💺 Booking Summary:

Date: ${session.draft.date}
Time: ${session.draft.slot}
Court: ${session.draft.courtName}
Amount: ₹${session.draft.amount}

Reply with 'confirm' to proceed with booking or 'cancel' to cancel.`;
    
    session.stage = "confirm_booking";
    await sendWhatsApp(from, summary);
    return res.end();
  }
  
  if (session.stage === "confirm_booking") {
    if (body === "confirm" || body.includes("confirm")) {
      // Validate time again before confirming booking
      const currentDate = new Date();
      const bookingDate = new Date(session.draft.date);
      
      // Check if booking time is valid (at least 2 hours in the future for today)
      let isTimeValid = true;
      if (bookingDate.toDateString() === currentDate.toDateString()) {
        try {
          // Extract the start time part (e.g., "6.00 PM" from "6.00 PM - 7.00 PM")
          const timeParts = session.draft.slot.split('-');
          if (timeParts.length >= 2) {
            const startTimeStr = timeParts[0].trim();
            
            // Create a date object for today with the slot's start time
            const slotStartTime = new Date(currentDate);
            
            // Handle time format with periods (6.00 PM) or colons (6:00 PM)
            let timeStr = startTimeStr.replace('.', ':');
            
            // Parse the time string into hours and minutes
            const isPM = timeStr.toLowerCase().includes('pm');
            const isAM = timeStr.toLowerCase().includes('am');
            
            // Remove AM/PM indicator and trim
            timeStr = timeStr.replace(/am|pm/i, '').trim();
            
            // Extract hours and minutes
            const [hours, minutes] = timeStr.split(':').map(Number);
            
            // Adjust hours for PM (add 12 to hours less than 12)
            let adjustedHours = hours;
            if (isPM && hours < 12) adjustedHours += 12;
            if (isAM && hours === 12) adjustedHours = 0;
            
            // Set the time on our date object
            slotStartTime.setHours(adjustedHours, minutes, 0, 0);
            
            // Add 2-hour buffer to current time
            const bufferTime = new Date(currentDate);
            bufferTime.setHours(bufferTime.getHours() + 2);
            
            // Check if start time is at least 2 hours in the future
            isTimeValid = slotStartTime > bufferTime;
          }
        } catch (error) {
          console.error(`Error validating time for booking:`, error);
          isTimeValid = false; // Fail safe if we can't parse the time
        }
      }
      
      // Also check if the court is still available
      const bookedCourts = await Booking.find({
        date: session.draft.date,
        slot: session.draft.slot,
        courtId: session.draft.courtId,
        status: { $in: ["confirmed", "pending_payment"] }
      });
      
      if (!isTimeValid) {
        await sendWhatsApp(from, "Sorry, this time slot is no longer available for booking. Please select a time slot at least 2 hours in the future.");
        session.stage = "choose_date";
        delete session.draft;
        return res.end();
      }
      
      if (bookedCourts.length > 0) {
        await sendWhatsApp(from, "Sorry, this court has already been booked for this time slot. Please try booking another court or time slot.");
        session.stage = "choose_date";
        delete session.draft;
        return res.end();
      }
      
      // create booking (pending_payment)
      const booking = await Booking.create({
        whatsapp: from,
        date: session.draft.date,
        slot: session.draft.slot,
        slotId: session.draft.slotId,
        courtId: session.draft.courtId,
        courtName: session.draft.courtName,
        amount: session.draft.amount,
        status: "pending_payment"
      });
      
      // create Razorpay payment link
      const paymentLink = (process.env.BASE_URL || "http://localhost:4000") + `/payment?booking=${booking._id}`;
      session.stage = "after_booking";
      session.bookingId = booking._id;
      
      // Mark this as a priority message since it's a booking confirmation
      const messageResult = await sendWhatsApp(from, 
`💼 Booking Summary:

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}
Amount: ₹${booking.amount}

Payment Link: ${paymentLink}

Please complete your payment using the link above.
Reply 'paid' after completing payment or 'cancel' to cancel booking.`, true); // true indicates this is a priority message

      // Check if message failed due to limits
      if (messageResult && messageResult.status === "error") {
        console.log(`[WARNING] Could not send booking confirmation to ${from} due to message limits`);
        // Continue processing anyway - user can still access booking via My Bookings
      }
      return res.end();
    } else if (body === "cancel" || body.includes("cancel")) {
      delete session.draft;
      session.stage = "menu";
      await sendWhatsApp(from, "Booking cancelled. Reply with 'menu' to see options.");
      return res.end();
    } else {
      await sendWhatsApp(from, "Please reply with 'confirm' to proceed with booking or 'cancel' to cancel.");
      return res.end();
    }
  }

  if (session.stage === "after_booking") {
    if (body.includes("paid")) {
      const booking = await Booking.findById(session.bookingId);
      if (!booking) {
        await sendWhatsApp(from, "Booking not found.");
        delete sessions[from];
        return res.end();
      }
      
      // Check if the court is still available before confirming
      const existingBookings = await Booking.find({
        date: booking.date,
        slotId: booking.slotId,
        courtId: booking.courtId,
        status: "confirmed",
        _id: { $ne: booking._id }
      });

      if (existingBookings.length > 0) {
        await sendWhatsApp(from, "Sorry, this court has already been booked for this time slot. Please try booking another court or time slot.");
        delete session.bookingId;
        session.stage = "menu";
        return res.end();
      }
      
      booking.status = "confirmed";
      booking.confirmedAt = new Date();
      await booking.save();
      
      // Generate a QR code for check-in
      const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking._id}`;
      
      // Generate receipt URL
      const receiptUrl = `${process.env.BASE_URL || "http://localhost:4000"}/payment/receipt/${booking._id}`;
      
      await sendWhatsApp(from, 
`💼 Booking Confirmed!

Booking ID: ${booking._id}
Date: ${booking.date}
Time: ${booking.slot}
Court: ${booking.courtName}
Amount: ₹${booking.amount}

QR Code for check-in: ${qrCodeLink}
Receipt: ${receiptUrl}

Thank you for booking with PicklePlay! Reply 'menu' to return to main menu.`);
      
      delete sessions[from];
      return res.end();
    } else if (body.includes("cancel")) {
      const booking = await Booking.findById(session.bookingId);
      if (booking) {
        booking.status = "cancelled";
        await booking.save();
        await sendWhatsApp(from, "Booking cancelled successfully. Reply 'menu' to return to main menu.");
      } else {
        await sendWhatsApp(from, "Booking not found. Reply 'menu' to return to main menu.");
      }
      delete sessions[from];
      return res.end();
    } else {
      await sendWhatsApp(from, "Please reply with 'paid' after completing payment or 'cancel' to cancel booking.");
      return res.end();
    }
  }

  // Default fallback
  await sendWhatsApp(from, "Sorry, I didn't understand. Reply 'hi' to restart or 'menu' to see options.");
  res.end();
} catch (error) {
  console.error("Error in Twilio webhook:", error);
  // Use a safe fallback if 'from' is not defined
  const phoneNumber = req.body.From || "unknown";
  try {
    await sendWhatsApp(phoneNumber, "Sorry, something went wrong. Please try again later or contact support.");
  } catch (innerError) {
    console.error("Failed to send error message:", innerError);
  }
  res.end();
}
});

module.exports = router;
