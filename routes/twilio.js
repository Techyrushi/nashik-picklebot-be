const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const Court = require("../models/Court");
const sendWhatsApp = require("../utils/sendWhatsApp");
const { nanoid } = require("nanoid");

const router = express.Router();

// Helper function to get the latest counter from database
async function getLatestCounter(counterType) {
  try {
    // You can create a separate counters collection or use the bookings collection
    const latestBooking = await Booking.findOne().sort({ createdAt: -1 });

    if (!latestBooking) {
      return 0; // No bookings yet, start from 0
    }

    if (counterType === 'booking') {
      // Extract number from bookingId like "NP-01" -> 1
      const match = latestBooking.bookingId.match(/NP-(\d+)/);
      return match ? parseInt(match[1]) : 0;
    } else if (counterType === 'invoice') {
      // Extract number from invoiceNumber like "NP-2025-01" -> 1
      const match = latestBooking.invoiceNumber.match(/NP-\d+-(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }

    return 0;
  } catch (error) {
    console.error('Error getting latest counter:', error);
    return 0;
  }
}

// Add this helper function to split long messages
async function sendSplitMessage(phoneNumber, message, maxLength = 1500) {
  if (message.length <= maxLength) {
    await sendWhatsApp(phoneNumber, message);
    return;
  }

  // Split by double newlines first to preserve paragraphs
  const paragraphs = message.split('\n\n');
  let currentMessage = '';

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed limit, send current message and start new one
    if ((currentMessage + paragraph + '\n\n').length > maxLength && currentMessage) {
      await sendWhatsApp(phoneNumber, currentMessage.trim());
      currentMessage = paragraph + '\n\n';
    } else {
      currentMessage += paragraph + '\n\n';
    }
  }

  // Send any remaining content
  if (currentMessage.trim()) {
    await sendWhatsApp(phoneNumber, currentMessage.trim());
  }
}

// Helper function to generate Booking ID (NP-01, NP-02, etc.)
async function generateBookingId() {
  const latestCounter = await getLatestCounter('booking');
  const nextCounter = latestCounter + 1;
  const id = `NP-${nextCounter.toString().padStart(2, '0')}`;
  return id;
}

// Helper function to generate Invoice Number (NP-2025-01, etc.)
async function generateInvoiceNumber() {
  const latestCounter = await getLatestCounter('invoice');
  const nextCounter = latestCounter + 1;
  const currentYear = new Date().getFullYear();
  const invoiceNo = `NP-${currentYear}-${nextCounter.toString().padStart(2, '0')}`;
  return invoiceNo;
}

// Helper function to generate available dates for next 7 days with day names
function getNextSevenDays() {
  const dates = [];
  const today = new Date();
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const formattedDate = date.toISOString().split("T")[0];
    const displayDate = `${date.getDate()} ${date.toLocaleString("default", {
      month: "short",
    })} ${days[date.getDay()]}`;
    const isPast = i === 0 && new Date().getHours() >= 22; // Consider past if after 10 PM today

    dates.push({
      value: formattedDate,
      display: displayDate,
      isPast: isPast || i < 0, // Disable past dates
    });
  }
  return dates;
}

// Helper function to calculate available players for a slot
async function getAvailablePlayersForSlot(date, slotTime, courtId) {
  const bookings = await Booking.find({
    date: date,
    slot: slotTime,
    courtId: courtId,
    status: { $in: ["confirmed", "pending_payment"] },
  });

  let bookedPlayers = 0;
  bookings.forEach((booking) => {
    bookedPlayers += booking.playerCount || 1; // Default to 1 if playerCount not set
  });

  return 4 - bookedPlayers; // Maximum 4 players per court
}

// Helper function to check if slot is available for players
async function isSlotAvailableForPlayers(
  date,
  slotTime,
  courtId,
  requiredPlayers
) {
  const availablePlayers = await getAvailablePlayersForSlot(
    date,
    slotTime,
    courtId
  );
  return availablePlayers >= requiredPlayers;
}

// Helper function to calculate amount based on duration and player count
function calculateAmount(duration, playerCount) {
  const pricePerPlayer = duration === "2 hours" ? 300 : 200;
  return pricePerPlayer * playerCount;
}

// Helper function to get duration from slot time
function getDurationFromSlot(slotTime) {
  // Assuming slot format like "7:00 AM - 8:00 AM" or "7:00 AM - 9:00 AM"
  const timeRange = slotTime.split(" - ");
  if (timeRange.length !== 2) return "1 hour";

  const startTime = new Date(`2000-01-01 ${timeRange[0]}`);
  const endTime = new Date(`2000-01-01 ${timeRange[1]}`);
  const durationHours = (endTime - startTime) / (1000 * 60 * 60);

  return durationHours === 2 ? "2 hours" : "1 hour";
}

// Helper function to parse time and check 2-hour buffer
function isTimeSlotAvailable(slotTime, selectedDate) {
  try {
    const currentDate = new Date();
    const bookingDate = new Date(selectedDate);

    // If booking is for future date, it's available
    if (bookingDate > currentDate) {
      return true;
    }

    // If booking is for today, check 2-hour buffer
    if (bookingDate.toDateString() === currentDate.toDateString()) {
      const timeParts = slotTime.split("-");
      if (timeParts.length < 2) return true;

      const startTimeStr = timeParts[0].trim();
      let timeStr = startTimeStr.replace(".", ":");

      const isPM = timeStr.toLowerCase().includes("pm");
      const isAM = timeStr.toLowerCase().includes("am");

      timeStr = timeStr.replace(/am|pm/i, "").trim();
      const [hours, minutes] = timeStr.split(":").map(Number);

      let adjustedHours = hours;
      if (isPM && hours < 12) adjustedHours += 12;
      if (isAM && hours === 12) adjustedHours = 0;

      const slotStartTime = new Date(currentDate);
      slotStartTime.setHours(adjustedHours, minutes, 0, 0);

      const bufferTime = new Date(currentDate);
      bufferTime.setHours(bufferTime.getHours() + 2);

      return slotStartTime > bufferTime;
    }

    return false;
  } catch (error) {
    console.error(`Error parsing time for slot ${slotTime}:`, error);
    return false;
  }
}

// Function to create payment link with expiry
function createPaymentLink(bookingId) {
  const baseUrl = process.env.BASE_URL || "http://localhost:4000";
  const paymentLink = `${baseUrl}/payment?booking=${bookingId}`;

  // Set expiry after 5 minutes
  setTimeout(async () => {
    try {
      const booking = await Booking.findById(bookingId);
      if (booking && booking.status === "pending_payment") {
        booking.status = "expired";
        await booking.save();

        // Send expiry message
        await sendWhatsApp(
          booking.whatsapp,
          `❌ *Payment Link Expired*\n\nYour payment link for booking ${booking.bookingId} has expired. Please book again to confirm your slot.\n\nReply 'menu' to return to main menu.`
        );
      }
    } catch (error) {
      console.error("Error handling payment link expiry:", error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  return paymentLink;
}

router.post("/", async (req, res) => {
  try {
    const from = req.body.From;
    const body = (req.body.Body || "").trim().toLowerCase();

    const userName = from.split("+")[1] || "there";

    router.sessions = router.sessions || {};
    const sessions = router.sessions;

    // Handle initial greeting or restart
    if (
      body === "hi" ||
      body === "hello" ||
      body === "restart" ||
      body === "exit" ||
      body === "Hi" ||
      body === "Hello" ||
      body === "menu"
    ) {
      delete sessions[from];
      sessions[from] = { stage: "menu" };
      await sendWhatsApp(
        from,
        `💶 *Welcome to NashikPicklers Court Booking!* 🎾

Hello +${userName}, please select an option:

*1️⃣ Book Court* - Reserve your court now
*2️⃣ My Bookings* - View your reservations
*3️⃣ Check Availability* - See open slots
*4️⃣ Pricing & Rules* - View our rates
*5️⃣ Contact Admin* - Get support

Reply with a number or option name.`
      );
      return res.end();
    }

    if (!sessions[from]) {
      sessions[from] = { stage: "menu" };
      await sendWhatsApp(
        from,
        `💶 *Welcome to NashikPicklers Court Booking!* 🎾

Hello +${userName}, please select an option:

*1️⃣ Book Court* - Reserve your court now
*2️⃣ My Bookings* - View your reservations
*3️⃣ Check Availability* - See open slots
*4️⃣ Pricing & Rules* - View our rates
*5️⃣ Contact Admin* - Get support

Reply with a number or option name.`
      );
      return res.end();
    }

    const session = sessions[from];

    if (session.stage === "menu") {
      if (body === "1" || body.includes("book")) {
        session.stage = "choose_date";
        const availableDates = getNextSevenDays();
        let dateOptions = "🗓️ *Select a Booking Date:*\n\n";
        availableDates.forEach((date, i) => {
          if (!date.isPast) {
            dateOptions += `*${i + 1}️⃣ ${date.display}*\n`;
          }
        });
        dateOptions += "\nReply with the date number.";
        session.availableDates = availableDates;
        await sendWhatsApp(from, dateOptions);
        return res.end();
      } else if (body === "2" || body.includes("my booking")) {
        const bookings = await Booking.find({ whatsapp: from });
        if (!bookings.length) {
          await sendWhatsApp(
            from,
            "📭 *You have no bookings.*\n\nReply with 'menu' to return to main menu."
          );
        } else {
          let text = "📚 *Your Bookings:*\n\n";
          bookings.forEach((b, i) => {
            text += `*Booking #${i + 1}*\n`;
            text += `🆔 ID: ${b.bookingId}\n`;
            text += `📅 Date: ${b.date}\n`;
            text += `⏰ Time: ${b.slot}\n`;
            text += `⏱️ Duration: ${b.duration}\n`;
            text += `🎾 Court: ${b.courtName}\n`;
            text += `👥 Players: ${b.playerCount || 1}\n`;
            text += `💰 Amount: ₹${b.amount}\n`;
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
          if (!date.isPast) {
            dateOptions += `*${i + 1}️⃣ ${date.display}*\n`;
          }
        });
        dateOptions += "\nReply with the date number.";
        session.availableDates = availableDates;
        await sendWhatsApp(from, dateOptions);
        return res.end();
      } else if (
        body === "4" ||
        body.includes("pricing") ||
        body.includes("rules")
      ) {
        let pricingInfo = `💰 *NashikPicklers Pricing & Rules*\n\n*Court Pricing (per player):*\n`;
        pricingInfo += `• 1 hour session: ₹200 per player\n`;
        pricingInfo += `• 2 hours session: ₹300 per player\n`;

        pricingInfo += `\n*Example Calculations:*\n`;
        pricingInfo += `• 2 players for 1 hour: ₹400\n`;
        pricingInfo += `• 3 players for 1 hour: ₹600\n`;
        pricingInfo += `• 4 players for 1 hour: ₹800\n`;
        pricingInfo += `• 2 players for 2 hours: ₹600\n`;
        pricingInfo += `• 3 players for 2 hours: ₹900\n`;
        pricingInfo += `• 4 players for 2 hours: ₹1200\n\n`;

        pricingInfo += `⏰ *Business Hours:*\n`;
        pricingInfo += `• 7:00 AM to 10:00 PM\n\n`;

        pricingInfo += `⚠️ *Booking Rules:*
• Bookings must be made at least 2 hours in advance
• Minimum 2 players required per booking
• Maximum 4 players per court
• Cancellations with full refund allowed up to 24 hours before
• Late cancellations incur a 50% fee
• No-shows are charged full amount
• Please arrive 10 minutes before your slot

Reply with 'menu' to return to main menu.`;

        await sendWhatsApp(from, pricingInfo);
        return res.end();
      } else if (
        body === "5" ||
        body.includes("contact") ||
        body.includes("admin")
      ) {
        await sendWhatsApp(
          from,
          `📞 *Contact NashikPicklers Admin*

For urgent matters:
📱 Call: +91-8862084297

For general inquiries:
📧 Email: nashikpicklers@gmail.com

📍 Location: https://maps.app.goo.gl/GmZp2m2pMo3LFGJy9?g_st=awb

⏰ *Operating Hours:*
Monday-Friday: 9:00 AM - 6:00 PM
Weekends: 10:00 AM - 4:00 PM

Reply with 'menu' to return to main menu.`
        );
        return res.end();
      } else if (body === "menu") {
        await sendWhatsApp(
          from,
          `💶 *NashikPicklers Court Booking* 🎾

*1️⃣ Book Court* - Reserve your court now
*2️⃣ My Bookings* - View your reservations
*3️⃣ Check Availability* - See open slots
*4️⃣ Pricing & Rules* - View our rates
*5️⃣ Contact Admin* - Get support

Reply with a number or option name.`
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "❌ *Invalid selection*\n\nPlease reply with a number from 1-5 or type 'menu' to see options."
        );
        return res.end();
      }
    }

    if (session.stage === "check_availability_date") {
      const idx = parseInt(body);
      const availableDates = session.availableDates || [];
      if (
        isNaN(idx) ||
        idx < 1 ||
        idx > availableDates.length ||
        availableDates[idx - 1].isPast
      ) {
        await sendWhatsApp(
          from,
          "❌ Invalid date selection. Please reply with a number from the list."
        );
        return res.end();
      }

      const selectedDate = availableDates[idx - 1].value;
      const slots = await Slot.find();
      const courts = await Court.find();

      // In the check_availability_date stage
      let availabilityMsg = `💸 Available time slots for ${availableDates[idx - 1].display}:\n\n`;

      if (!slots.length || !courts.length) {
        availabilityMsg = "No time slots or courts configured. Please try another date or contact admin.";
      } else {
        let hasAvailableSlots = false;
        let slotMessages = [];

        for (const slot of slots) {
          if (!isTimeSlotAvailable(slot.time, selectedDate)) {
            continue;
          }

          let slotInfo = `*${slot.time}:*\n`;
          let hasAvailableCourts = false;

          for (const court of courts) {
            const availablePlayers = await getAvailablePlayersForSlot(
              selectedDate,
              slot.time,
              court._id
            );
            if (availablePlayers >= 2) {
              const duration = getDurationFromSlot(slot.time);
              const pricePerPlayer = duration === "2 hours" ? 300 : 200;
              slotInfo += `  • ${court.name}: ${availablePlayers} players available (₹${pricePerPlayer}/player for ${duration})\n`;
              hasAvailableCourts = true;
              hasAvailableSlots = true;
            }
          }

          if (hasAvailableCourts) {
            slotMessages.push(slotInfo);
          }
        }

        if (!hasAvailableSlots) {
          availabilityMsg = "No available time slots for this date. Please select another date.";
        } else {
          // Send availability in chunks to avoid exceeding character limit
          let currentChunk = availabilityMsg;

          for (const slotMsg of slotMessages) {
            if ((currentChunk + slotMsg + "\n").length > 1500) {
              await sendSplitMessage(from, currentChunk);
              currentChunk = slotMsg + "\n";
            } else {
              currentChunk += slotMsg + "\n";
            }
          }

          availabilityMsg = currentChunk + "\nReply with 'book' to make a booking or 'menu' to return to main menu.";
        }
      }

      await sendSplitMessage(from, availabilityMsg);
      session.stage = "after_availability";
      return res.end();
    }

    if (session.stage === "after_availability") {
      if (body === "book" || body.includes("book")) {
        session.stage = "choose_date";
        const availableDates = getNextSevenDays();
        let dateOptions = "💷 *Please select a date for your booking:*\n\n";
        availableDates.forEach((date, i) => {
          if (!date.isPast) {
            dateOptions += `*${i + 1}️⃣ ${date.display}*\n`;
          }
        });
        dateOptions += "\nReply with the date number.";
        session.availableDates = availableDates;
        await sendWhatsApp(from, dateOptions);
        return res.end();
      } else if (body === "menu") {
        session.stage = "menu";
        await sendWhatsApp(
          from,
          `1. Book Court
2. My Bookings
3. Check Availability
4. Pricing & Rules
5. Contact Admin

Reply with the number or option name.`
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'book' to make a booking or 'menu' to return to main menu."
        );
        return res.end();
      }
    }

    if (session.stage === "choose_date") {
      const idx = parseInt(body);
      const availableDates = session.availableDates || [];

      if (
        isNaN(idx) ||
        idx < 1 ||
        idx > availableDates.length ||
        availableDates[idx - 1].isPast
      ) {
        await sendWhatsApp(
          from,
          "❌ Invalid date selection. Please reply with a number from the list."
        );
        return res.end();
      }

      const selectedDate = availableDates[idx - 1].value;
      session.draft = {
        date: selectedDate,
        dateDisplay: availableDates[idx - 1].display,
      };

      session.stage = "choose_players";

      let playerOptions = `👥 *Select Number of Players*\n\n`;
      playerOptions += `*Pricing Information:*\n`;
      playerOptions += `• 1 hour session: ₹200 per player\n`;
      playerOptions += `• 2 hours session: ₹300 per player\n\n`;
      playerOptions += `*Example Calculations:*\n`;
      playerOptions += `• 2 players for 1 hour: ₹400\n`;
      playerOptions += `• 3 players for 1 hour: ₹600\n`;
      playerOptions += `• 4 players for 1 hour: ₹800\n`;
      playerOptions += `• 2 players for 2 hours: ₹600\n`;
      playerOptions += `• 3 players for 2 hours: ₹900\n`;
      playerOptions += `• 4 players for 2 hours: ₹1200\n\n`;
      playerOptions += `Minimum: 2 players\nMaximum: 4 players per court\n\n`;
      playerOptions += `Reply with the number of players (2, 3, or 4).`;

      await sendWhatsApp(from, playerOptions);
      return res.end();
    }

    if (session.stage === "choose_players") {
      const playerCount = parseInt(body);
      if (isNaN(playerCount) || playerCount < 2 || playerCount > 4) {
        await sendWhatsApp(
          from,
          "❌ Invalid player count. Please reply with 2, 3, or 4 players."
        );
        return res.end();
      }

      session.draft.playerCount = playerCount;

      const slots = await Slot.find({ status: "Active" });
      if (!slots.length) {
        await sendWhatsApp(from, "No slots configured. Contact admin.");
        delete sessions[from];
        return res.end();
      }

      // Filter available slots based on time and player availability
      const courts = await Court.find({ status: "Active" });
      let availableSlots = [];

      for (const slot of slots) {
        if (!isTimeSlotAvailable(slot.time, session.draft.date)) {
          continue;
        }

        // Check if any court has enough capacity for requested players
        let hasAvailableCourt = false;
        for (const court of courts) {
          const isAvailable = await isSlotAvailableForPlayers(
            session.draft.date,
            slot.time,
            court._id,
            playerCount
          );
          if (isAvailable) {
            hasAvailableCourt = true;
            break;
          }
        }

        if (hasAvailableCourt) {
          availableSlots.push(slot);
        }
      }

      if (!availableSlots.length) {
        await sendWhatsApp(
          from,
          `❌ No available time slots for ${session.draft.dateDisplay} with ${playerCount} players.

Please reply with:
• 'back' to choose different number of players
• 'menu' to return to main menu`
        );
        session.stage = "no_slots_available";
        return res.end();
      }

      function parseTimeToNumber(slotTime) {
        const [startTime] = slotTime.split(" - ");
        const [time, meridian] = startTime.trim().split(" ");

        let [hour, minute] = time.split(":").map(Number);

        if (meridian === "PM" && hour !== 12) hour += 12;
        if (meridian === "AM" && hour === 12) hour = 0;

        return hour * 60 + minute;
      }

      // Sort available slots array based on start time
      availableSlots.sort((a, b) => {
        return parseTimeToNumber(a.time) - parseTimeToNumber(b.time);
      });

      let msg = `⏰ Available time slots for ${session.draft.dateDisplay} (${playerCount} players):\n\n`;
      availableSlots.forEach((s, i) => {
        const duration = getDurationFromSlot(s.time);
        const pricePerPlayer = duration === "2 hours" ? 300 : 200;
        const totalPrice = pricePerPlayer * session.draft.playerCount;
        msg += `*${i + 1}. ${s.time}* (${duration}) - ₹${totalPrice}\n`;
      });
      msg += "\nReply with the slot number.";
      msg += "\nReply 'back' to choose different number of players.";

      session.slots = availableSlots;
      session.stage = "choose_slot";
      await sendWhatsApp(from, msg);
      return res.end();
    }

    if (session.stage === "no_slots_available") {
      if (body === "back") {
        session.stage = "choose_players";

        let playerOptions = `👥 *Select Number of Players*\n\n`;
        playerOptions += `*Pricing Information:*\n`;
        playerOptions += `• 1 hour session: ₹200 per player\n`;
        playerOptions += `• 2 hours session: ₹300 per player\n\n`;
        playerOptions += `*Example Calculations:*\n`;
        playerOptions += `• 2 players for 1 hour: ₹400\n`;
        playerOptions += `• 3 players for 1 hour: ₹600\n`;
        playerOptions += `• 4 players for 1 hour: ₹800\n`;
        playerOptions += `• 2 players for 2 hours: ₹600\n`;
        playerOptions += `• 3 players for 2 hours: ₹900\n`;
        playerOptions += `• 4 players for 2 hours: ₹1200\n\n`;
        playerOptions += `Minimum: 2 players\nMaximum: 4 players per court\n\n`;
        playerOptions += `Reply with the number of players (2, 3, or 4).`;

        await sendWhatsApp(from, playerOptions);
        return res.end();
      } else if (body === "menu") {
        session.stage = "menu";
        await sendWhatsApp(
          from,
          `1. Book Court
2. My Bookings
3. Check Availability
4. Pricing & Rules
5. Contact Admin

Reply with the number or option name.`
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'back' to choose different players or 'menu' for main menu."
        );
        return res.end();
      }
    }

    if (session.stage === "choose_slot") {
      if (body === "back") {
        session.stage = "choose_players";

        let playerOptions = `👥 *Select Number of Players*\n\n`;
        playerOptions += `*Pricing Information:*\n`;
        playerOptions += `• 1 hour session: ₹200 per player\n`;
        playerOptions += `• 2 hours session: ₹300 per player\n\n`;
        playerOptions += `Minimum: 2 players\nMaximum: 4 players per court\n\n`;
        playerOptions += `Reply with the number of players (2, 3, or 4).`;

        await sendWhatsApp(from, playerOptions);
        return res.end();
      }

      const idx = parseInt(body);
      const slots = session.slots || [];
      if (isNaN(idx) || idx < 1 || idx > slots.length) {
        await sendWhatsApp(
          from,
          "❌ Invalid slot. Reply with the slot number or 'back' to choose players."
        );
        return res.end();
      }

      const slot = slots[idx - 1];
      session.draft.slot = slot.time;
      session.draft.slotId = slot._id;
      session.draft.duration = getDurationFromSlot(slot.time);

      // Get available courts for this slot and player count
      const courts = await Court.find();
      const availableCourts = [];

      for (const court of courts) {
        const isAvailable = await isSlotAvailableForPlayers(
          session.draft.date,
          session.draft.slot,
          court._id,
          session.draft.playerCount
        );

        if (isAvailable) {
          availableCourts.push(court);
        }
      }

      if (!availableCourts.length) {
        await sendWhatsApp(
          from,
          "No courts available for this time slot. Please select another time slot."
        );
        session.stage = "choose_slot";
        return res.end();
      }

      let msg = `🎾 Available courts for ${session.draft.dateDisplay} – ${session.draft.slot} (${session.draft.playerCount} players):\n\n`;
      availableCourts.forEach((c, i) => {
        const courtAmount = calculateAmount(session.draft.duration, session.draft.playerCount);
        msg += `*${i + 1}. ${c.name}* - ₹${courtAmount} (${session.draft.duration})\n`;
      });
      msg += "\nReply with the court number.";
      msg += "\nReply 'back' to choose different time slot.";

      session.courts = availableCourts;
      session.stage = "choose_court";
      await sendWhatsApp(from, msg);
      return res.end();
    }

    if (session.stage === "choose_court") {
      if (body === "back") {
        session.stage = "choose_slot";
        let msg = `⏰ Available time slots for ${session.draft.dateDisplay} (${session.draft.playerCount} players):\n\n`;
        session.slots.forEach((s, i) => {
          const duration = getDurationFromSlot(s.time);
          const pricePerPlayer = duration === "2 hours" ? 300 : 200;
          const totalPrice = pricePerPlayer * session.draft.playerCount;
          msg += `*${i + 1}. ${s.time}* (${duration}) - ₹${totalPrice}\n`;
        });
        msg += "\nReply with the slot number.";
        msg += "\nReply 'back' to choose different number of players.";
        await sendWhatsApp(from, msg);
        return res.end();
      }

      const idx = parseInt(body);
      const courts = session.courts || [];
      if (isNaN(idx) || idx < 1 || idx > courts.length) {
        await sendWhatsApp(
          from,
          "❌ Invalid court. Reply with court number or 'back' for time slots."
        );
        return res.end();
      }

      const court = courts[idx - 1];
      session.draft.courtId = court._id;
      session.draft.courtName = court.name;
      session.draft.amount = calculateAmount(
        session.draft.duration,
        session.draft.playerCount
      );

      // Generate booking summary and show payment link directly
      const bookingId = await generateBookingId();
      const invoiceNumber = await generateInvoiceNumber();

      const summary = `💺 *Booking Summary:*

🆔 Booking ID: ${bookingId}
📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${session.draft.slot}
⏱️ Duration: ${session.draft.duration}
🎾 Court: ${session.draft.courtName}
👥 Players: ${session.draft.playerCount}
💵 Total Amount: ₹${session.draft.amount}

*Payment Required to Confirm Booking*

💰 *Payment Link:* ${createPaymentLink(bookingId)}

⚠️ *Payment expires in 5 minutes*

Reply 'cancel' to cancel this booking.
Reply 'menu' to return to main menu.`;

      // Create booking with pending_payment status
      const booking = await Booking.create({
        bookingId: bookingId,
        invoiceNumber: invoiceNumber,
        whatsapp: from,
        date: session.draft.date,
        slot: session.draft.slot,
        slotId: session.draft.slotId,
        courtId: session.draft.courtId,
        courtName: session.draft.courtName,
        duration: session.draft.duration,
        playerCount: session.draft.playerCount,
        amount: session.draft.amount,
        status: "pending_payment",
      });

      session.bookingId = booking._id;
      session.stage = "payment_pending";

      await sendWhatsApp(from, summary);
      return res.end();
    }

    if (session.stage === "payment_pending") {
      if (body.includes("paid")) {
        const booking = await Booking.findById(session.bookingId);
        if (!booking) {
          await sendWhatsApp(from, "Booking not found.");
          delete sessions[from];
          return res.end();
        }

        // Check if the court still has capacity
        const isAvailable = await isSlotAvailableForPlayers(
          booking.date,
          booking.slot,
          booking.courtId,
          booking.playerCount
        );

        if (!isAvailable) {
          await sendWhatsApp(
            from,
            "Sorry, this court doesn't have enough capacity anymore. Please try booking another court or time slot."
          );

          // Refund logic would go here
          booking.status = "cancelled";
          await booking.save();

          delete session.bookingId;
          session.stage = "menu";
          return res.end();
        }

        booking.status = "confirmed";
        booking.confirmedAt = new Date();
        await booking.save();

        // Generate QR code for check-in
        const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking.bookingId}`;
        const receiptUrl = `${process.env.BASE_URL || "http://localhost:4000"
          }/payment/receipt/${booking._id}`;

        await sendWhatsApp(
          from,
          `✅ *Booking Confirmed!*

🆔 Booking ID: ${booking.bookingId}
📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${booking.slot}
⏱️ Duration: ${booking.duration}
🎾 Court: ${booking.courtName}
👥 Players: ${booking.playerCount}
💵 Total Amount: ₹${booking.amount}
📄 Invoice: ${booking.invoiceNumber}

QR Code for check-in: ${qrCodeLink}
Receipt: ${receiptUrl}

Reply 'menu' for main menu.`
        );

        session.stage = "booking_confirmed";
        return res.end();
      } else if (body === "cancel" || body.includes("cancel")) {
        const booking = await Booking.findById(session.bookingId);
        if (booking) {
          booking.status = "cancelled";
          await booking.save();
          await sendWhatsApp(
            from,
            "Booking cancelled successfully. Reply 'menu' to return to main menu."
          );
        } else {
          await sendWhatsApp(
            from,
            "Booking not found. Reply 'menu' to return to main menu."
          );
        }
        delete sessions[from];
        return res.end();
      } else if (body === "menu") {
        session.stage = "menu";
        await sendWhatsApp(
          from,
          `1. Book Court
2. My Bookings
3. Check Availability
4. Pricing & Rules
5. Contact Admin

Reply with the number or option name.`
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'paid' after completing payment, 'cancel' to cancel booking, or 'menu' for main menu."
        );
        return res.end();
      }
    }

    if (session.stage === "booking_confirmed") {
      if (body === "menu") {
        session.stage = "menu";
        await sendWhatsApp(
          from,
          `1. Book Court
2. My Bookings
3. Check Availability
4. Pricing & Rules
5. Contact Admin

Reply with the number or option name.`
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'menu' to return to main menu."
        );
        return res.end();
      }
    }

    // Default fallback
    await sendWhatsApp(
      from,
      "Sorry, I didn't understand. Reply 'hi' to restart or 'menu' to see options."
    );
    res.end();
  } catch (error) {
    console.error("Error in Twilio webhook:", error);
    const phoneNumber = req.body.From || "unknown";
    try {
      await sendWhatsApp(
        phoneNumber,
        "Sorry, something went wrong. Please try again later or contact support."
      );
    } catch (innerError) {
      console.error("Failed to send error message:", innerError);
    }
    res.end();
  }
});

module.exports = router;