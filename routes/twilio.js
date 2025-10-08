const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const Court = require("../models/Court");
const sendWhatsApp = require("../utils/sendWhatsApp");
const { nanoid } = require("nanoid");

const router = express.Router();

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

// Helper function to calculate amount based on court price and player count
function calculateAmount(courtPrice, playerCount) {
  return courtPrice * playerCount;
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

Hello ${userName}, please select an option:

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
            text += `🆔 ID: ${b._id}\n`;
            text += `📅 Date: ${b.date}\n`;
            text += `⏰ Time: ${b.slot}\n`;
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
        // Get court prices from database to show dynamic pricing
        const courts = await Court.find();
        let pricingInfo = `💰 *NashikPicklers Pricing & Rules*\n\n*Court Pricing (per player):*\n`;

        courts.forEach((court) => {
          pricingInfo += `• ${court.name}: ₹${court.price} per player\n`;
        });

        pricingInfo += `\n*Example Calculations:*\n`;
        courts.forEach((court) => {
          pricingInfo += `• ${court.name} with 2 players: ₹${
            court.price * 2
          }\n`;
          pricingInfo += `• ${court.name} with 3 players: ₹${
            court.price * 3
          }\n`;
          pricingInfo += `• ${court.name} with 4 players: ₹${
            court.price * 4
          }\n\n`;
        });

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

      let availabilityMsg = `💸 Available time slots for ${
        availableDates[idx - 1].display
      }:\n\n`;

      if (!slots.length || !courts.length) {
        availabilityMsg =
          "No time slots or courts configured. Please try another date or contact admin.";
      } else {
        let hasAvailableSlots = false;

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
              // Minimum 2 players required
              slotInfo += `  • ${court.name}: ${availablePlayers} players available (₹${court.price}/player)\n`;
              hasAvailableCourts = true;
              hasAvailableSlots = true;
            }
          }

          if (hasAvailableCourts) {
            availabilityMsg += slotInfo + "\n";
          }
        }

        if (!hasAvailableSlots) {
          availabilityMsg =
            "No available time slots for this date. Please select another date.";
        }
      }

      availabilityMsg +=
        "\nReply with 'book' to make a booking or 'menu' to return to main menu.";
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

      // Get court prices to show pricing information
      const courts = await Court.find();
      let playerOptions = `👥 *Select Number of Players*\n\nMinimum: 2 players\nMaximum: 4 players per court\n\n`;

      courts.forEach((court) => {
        playerOptions += `*${court.name} Pricing:*\n`;
        playerOptions += `• 2 players: ₹${court.price * 2}\n`;
        playerOptions += `• 3 players: ₹${court.price * 3}\n`;
        playerOptions += `• 4 players: ₹${court.price * 4}\n\n`;
      });

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
      // Amount will be calculated later when court is selected

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
        // slotTime example: "7:00 PM - 8:00 PM"
        const [startTime] = slotTime.split(" - "); // take first part before '-'
        const [time, meridian] = startTime.trim().split(" "); // ["7:00", "PM"]

        let [hour, minute] = time.split(":").map(Number);

        // Convert 12-hour to 24-hour
        if (meridian === "PM" && hour !== 12) hour += 12;
        if (meridian === "AM" && hour === 12) hour = 0;

        return hour * 60 + minute; // total minutes since midnight
      }

      // Sort your available slots array based on start time
      availableSlots.sort((a, b) => {
        return parseTimeToNumber(a.time) - parseTimeToNumber(b.time);
      });

      let msg = `⏰ Available time slots for ${session.draft.dateDisplay} (${playerCount} players):\n\n`;
      availableSlots.forEach((s, i) => (msg += `*${i + 1}. ${s.time}*\n`));
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

        // Get court prices to show pricing information
        const courts = await Court.find();
        let playerOptions = `👥 *Select Number of Players*\n\nMinimum: 2 players\nMaximum: 4 players per court\n\n`;

        courts.forEach((court) => {
          playerOptions += `*${court.name} Pricing:*\n`;
          playerOptions += `• 2 players: ₹${court.price * 2}\n`;
          playerOptions += `• 3 players: ₹${court.price * 3}\n`;
          playerOptions += `• 4 players: ₹${court.price * 4}\n\n`;
        });

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

        // Get court prices to show pricing information
        const courts = await Court.find();
        let playerOptions = `👥 *Select Number of Players*\n\nMinimum: 2 players\nMaximum: 4 players per court\n\n`;

        courts.forEach((court) => {
          playerOptions += `*${court.name} Pricing:*\n`;
          playerOptions += `• 2 players: ₹${court.price * 2}\n`;
          playerOptions += `• 3 players: ₹${court.price * 3}\n`;
          playerOptions += `• 4 players: ₹${court.price * 4}\n\n`;
        });

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
        const courtAmount = calculateAmount(c.price, session.draft.playerCount);
        msg += `*${i + 1}. ${c.name}* - ₹${c.price}/player × ${
          session.draft.playerCount
        } = ₹${courtAmount}\n`;
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
        session.slots.forEach((s, i) => (msg += `*${i + 1}. ${s.time}*\n`));
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
      session.draft.courtPrice = court.price;
      session.draft.amount = calculateAmount(
        court.price,
        session.draft.playerCount
      );

      // Show booking summary before creating
      const summary = `💺 *Booking Summary:*

📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${session.draft.slot}
🎾 Court: ${session.draft.courtName}
💰 Court Price: ₹${session.draft.courtPrice} per player
👥 Players: ${session.draft.playerCount}
💵 Total Amount: ₹${session.draft.courtPrice} × ${session.draft.playerCount} = ₹${session.draft.amount}

Reply with 'confirm' to proceed with booking.
Reply 'back' to choose different court.
Reply 'cancel' to cancel booking.`;

      session.stage = "confirm_booking";
      await sendWhatsApp(from, summary);
      return res.end();
    }

    if (session.stage === "confirm_booking") {
      if (body === "back") {
        session.stage = "choose_court";
        let msg = `🎾 Available courts for ${session.draft.dateDisplay} – ${session.draft.slot} (${session.draft.playerCount} players):\n\n`;
        session.courts.forEach((c, i) => {
          const courtAmount = calculateAmount(
            c.price,
            session.draft.playerCount
          );
          msg += `*${i + 1}. ${c.name}* - ₹${c.price}/player × ${
            session.draft.playerCount
          } = ₹${courtAmount}\n`;
        });
        msg += "\nReply with the court number.";
        await sendWhatsApp(from, msg);
        return res.end();
      } else if (body === "confirm" || body.includes("confirm")) {
        // Validate time again before confirming booking
        if (!isTimeSlotAvailable(session.draft.slot, session.draft.date)) {
          await sendWhatsApp(
            from,
            "Sorry, this time slot is no longer available for booking. Please select a time slot at least 2 hours in the future."
          );
          session.stage = "choose_date";
          delete session.draft;
          return res.end();
        }

        // Check if the court still has capacity for requested players
        const isAvailable = await isSlotAvailableForPlayers(
          session.draft.date,
          session.draft.slot,
          session.draft.courtId,
          session.draft.playerCount
        );

        if (!isAvailable) {
          await sendWhatsApp(
            from,
            "Sorry, this court doesn't have enough capacity for your requested players. Please try booking another court or time slot."
          );
          session.stage = "choose_date";
          delete session.draft;
          return res.end();
        }

        // Create booking (pending_payment)
        const booking = await Booking.create({
          whatsapp: from,
          date: session.draft.date,
          slot: session.draft.slot,
          slotId: session.draft.slotId,
          courtId: session.draft.courtId,
          courtName: session.draft.courtName,
          courtPrice: session.draft.courtPrice, // Store court price for reference
          playerCount: session.draft.playerCount,
          amount: session.draft.amount,
          status: "pending_payment",
        });

        // Create Razorpay payment link
        const paymentLink =
          (process.env.BASE_URL || "http://localhost:4000") +
          `/payment?booking=${booking._id}`;
        session.stage = "after_booking";
        session.bookingId = booking._id;

        await sendWhatsApp(
          from,
          `💼 *Booking Summary:*

Booking ID: ${booking._id}
📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${booking.slot}
🎾 Court: ${booking.courtName}
💰 Court Price: ₹${booking.courtPrice} per player
👥 Players: ${booking.playerCount}
💵 Total Amount: ₹${booking.amount}

Payment Link: ${paymentLink}

Please complete your payment using the link above.
Reply 'cancel' to cancel booking.
Reply 'modify' to modify this booking.`,
          true
        );

        return res.end();
      } else if (body === "cancel" || body.includes("cancel")) {
        delete session.draft;
        session.stage = "menu";
        await sendWhatsApp(
          from,
          "Booking cancelled. Reply with 'menu' to see options."
        );
        return res.end();
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'confirm' to proceed, 'back' for courts, or 'cancel' to cancel."
        );
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
        const qrCodeLink = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${booking._id}`;
        const receiptUrl = `${
          process.env.BASE_URL || "http://localhost:4000"
        }/payment/receipt/${booking._id}`;

        await sendWhatsApp(
          from,
          `✅ *Booking Confirmed!*

Booking ID: ${booking._id}
📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${booking.slot}
🎾 Court: ${booking.courtName}
💰 Court Price: ₹${booking.courtPrice} per player
👥 Players: ${booking.playerCount}
💵 Total Amount: ₹${booking.amount}

QR Code for check-in: ${qrCodeLink}
Receipt: ${receiptUrl}

Reply 'modify' to modify booking.
Reply 'cancel' to cancel booking.
Reply 'menu' for main menu.`
        );

        session.stage = "booking_confirmed";
        return res.end();
      } else if (body.includes("modify")) {
        // Store current booking info and start modification
        session.originalBookingId = session.bookingId;
        session.stage = "choose_date";
        session.isModifying = true;

        const availableDates = getNextSevenDays();
        let dateOptions = "🗓️ *Select New Booking Date:*\n\n";
        availableDates.forEach((date, i) => {
          if (!date.isPast) {
            dateOptions += `*${i + 1}️⃣ ${date.display}*\n`;
          }
        });
        dateOptions += "\nReply with the date number.";
        session.availableDates = availableDates;

        await sendWhatsApp(
          from,
          "🔄 *Modify Booking*\n\nLet's update your booking. First, select a new date:"
        );
        await sendWhatsApp(from, dateOptions);
        return res.end();
      } else if (body.includes("cancel")) {
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
      } else {
        await sendWhatsApp(
          from,
          "Please reply with 'paid' after payment, 'modify' to change booking, or 'cancel' to cancel."
        );
        return res.end();
      }
    }

    if (session.stage === "booking_confirmed") {
      if (body.includes("modify")) {
        session.stage = "choose_date";
        session.isModifying = true;
        session.originalBookingId = session.bookingId;

        const availableDates = getNextSevenDays();
        let dateOptions = "🗓️ *Select New Booking Date:*\n\n";
        availableDates.forEach((date, i) => {
          if (!date.isPast) {
            dateOptions += `*${i + 1}️⃣ ${date.display}*\n`;
          }
        });
        dateOptions += "\nReply with the date number.";
        session.availableDates = availableDates;

        await sendWhatsApp(
          from,
          "🔄 *Modify Booking*\n\nLet's update your booking. First, select a new date:"
        );
        await sendWhatsApp(from, dateOptions);
        return res.end();
      } else if (body.includes("cancel")) {
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
          "Please reply with 'modify' to change booking, 'cancel' to cancel, or 'menu' for main menu."
        );
        return res.end();
      }
    }

    // Handle modification completion
    if (session.stage === "confirm_booking" && session.isModifying) {
      if (body === "confirm" || body.includes("confirm")) {
        // Create new booking for modification
        const newBooking = await Booking.create({
          whatsapp: from,
          date: session.draft.date,
          slot: session.draft.slot,
          slotId: session.draft.slotId,
          courtId: session.draft.courtId,
          courtName: session.draft.courtName,
          courtPrice: session.draft.courtPrice,
          playerCount: session.draft.playerCount,
          amount: session.draft.amount,
          status: "pending_payment",
          modifiedFrom: session.originalBookingId,
        });

        // Cancel original booking
        await Booking.findByIdAndUpdate(session.originalBookingId, {
          status: "modified",
          modifiedTo: newBooking._id,
        });

        const paymentLink =
          (process.env.BASE_URL || "http://localhost:4000") +
          `/payment?booking=${newBooking._id}`;
        session.bookingId = newBooking._id;
        session.stage = "after_booking";
        delete session.isModifying;
        delete session.originalBookingId;

        await sendWhatsApp(
          from,
          `🔄 *Booking Modified!*

New Booking ID: ${newBooking._id}
📅 Date: ${session.draft.dateDisplay}
⏰ Time: ${newBooking.slot}
🎾 Court: ${newBooking.courtName}
💰 Court Price: ₹${newBooking.courtPrice} per player
👥 Players: ${newBooking.playerCount}
💵 Total Amount: ₹${newBooking.amount}

Payment Link: ${paymentLink}

Please complete payment for the modified booking.
Reply 'paid' after payment.`
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
