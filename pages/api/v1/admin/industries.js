import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession } from "../../_lib/auth.js";

function getIndustryKey(req) {
  return String(req.query?.industryKey || "");
}

async function fetchSeedDefaults(pool, industryKey, defaultFaqs, defaultPrompts, options = {}) {
  const forcePrompt = options.forcePrompt === true;
  const forceFaqs = options.forceFaqs === true;
  const inserted = { faqs: 0, prompt: 0 };
  const existingFaqs = await pool.query(
    `SELECT COUNT(*)::int AS count FROM industry_faqs WHERE industry_key = $1`,
    [industryKey]
  );
  const existingPrompt = await pool.query(
    `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
    [industryKey]
  );
  if (forceFaqs) {
    await pool.query(`DELETE FROM industry_faqs WHERE industry_key = $1`, [industryKey]);
  }
  if (forceFaqs || (existingFaqs.rows[0]?.count || 0) === 0) {
    const faqs = defaultFaqs[industryKey] || [];
    for (const faq of faqs) {
      await pool.query(
        `INSERT INTO industry_faqs (industry_key, question, answer, category)
         VALUES ($1, $2, $3, $4)`,
        [industryKey, faq.question, faq.answer, faq.category]
      );
    }
    inserted.faqs = faqs.length;
  }
  if ((forcePrompt || !existingPrompt.rowCount) && defaultPrompts[industryKey]) {
    await pool.query(
      `INSERT INTO industry_prompts (industry_key, prompt)
       VALUES ($1, $2)
       ON CONFLICT (industry_key)
       DO UPDATE SET prompt = EXCLUDED.prompt,
                     updated_at = NOW()`,
      [industryKey, defaultPrompts[industryKey]]
    );
    inserted.prompt = 1;
  }
  return inserted;
}

const DEFAULT_FAQS = {
  plumbing: [
    { question: "Do you offer emergency plumbing?", answer: "Yes. We prioritize active leaks, flooding, and sewage issues.", category: "Emergency" },
    { question: "What should I do for a burst pipe?", answer: "Shut off the main water valve if it’s safe, then call us right away.", category: "Emergency" },
    { question: "What should I do if I smell gas?", answer: "Please leave the home immediately and call 911 first. Once you’re safe, call us back.", category: "Emergency" },
    { question: "Do you handle drain clogs and backups?", answer: "Yes. We clear clogs, inspect lines, and recommend next steps.", category: "Services" },
    { question: "Do you fix leaking faucets or toilets?", answer: "Yes. We repair fixtures and replace worn parts.", category: "Services" },
    { question: "Do you repair or replace water heaters?", answer: "Yes. We service standard and tankless water heaters.", category: "Services" },
    { question: "Do you work on sewer lines?", answer: "Yes. We can inspect and repair sewer and drain lines.", category: "Services" },
    { question: "Do you install new fixtures?", answer: "Yes. We install faucets, toilets, disposals, and more.", category: "Services" },
    { question: "Can you locate a leak?", answer: "Yes. We can diagnose leaks and explain next steps.", category: "Services" },
    { question: "What areas do you service?", answer: "We serve the local area. Share your address and we’ll confirm coverage.", category: "Coverage" },
    { question: "How quickly can someone come out?", answer: "We prioritize urgent issues and schedule the soonest available time.", category: "Scheduling" },
    { question: "Do I need to be home for the visit?", answer: "For most repairs, yes. We can discuss access if needed.", category: "Scheduling" },
    { question: "How do I prepare for a visit?", answer: "Clear access to the problem area and ensure water shutoff is reachable.", category: "Preparation" },
    { question: "Will you provide an estimate?", answer: "Yes. The technician will review the issue and provide pricing before work begins.", category: "Pricing" },
    { question: "Do you charge a service fee?", answer: "We’ll let you know any service or diagnostic fee when scheduling.", category: "Pricing" },
    { question: "Do you handle insurance claims?", answer: "We can provide documentation to help with claims.", category: "Process" },
    { question: "Do you guarantee your work?", answer: "We stand by our repairs and will review any concerns.", category: "Warranty" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Will you clean up after the repair?", answer: "Yes. We aim to leave the area clean and safe.", category: "Process" },
    { question: "What if the issue comes back?", answer: "Call us and we’ll take a look. We want the problem resolved.", category: "Support" }
  ],
  window_installers: [
    { question: "Do you offer window replacement?", answer: "Yes. We replace and install new windows.", category: "Services" },
    { question: "Do you replace glass only?", answer: "It depends on frame condition and window type; we confirm after an inspection.", category: "Services" },
    { question: "How long does window replacement take?", answer: "Once windows arrive, most homes are done in 1–2 days. Timing depends on the number of windows.", category: "Scheduling" },
    { question: "What is the typical lead time?", answer: "Standard windows often take a few weeks; custom windows can take longer. We confirm after measuring.", category: "Scheduling" },
    { question: "Do you do free estimates?", answer: "Yes. We can schedule an in-home measurement and estimate.", category: "Pricing" },
    { question: "Do you measure for windows?", answer: "Yes. We take precise measurements before ordering.", category: "Process" },
    { question: "Can you match existing styles?", answer: "We’ll review style options and help you match your home.", category: "Process" },
    { question: "Do you install patio doors?", answer: "Yes. We install sliding and hinged patio doors.", category: "Services" },
    { question: "Do you handle permits?", answer: "If permits are required, we can help coordinate them.", category: "Process" },
    { question: "Are the windows energy efficient?", answer: "We offer energy-efficient options and will explain ratings.", category: "Products" },
    { question: "Is there a warranty?", answer: "Yes. We’ll provide manufacturer and workmanship warranty details.", category: "Warranty" },
    { question: "Do you do repairs or only replacements?", answer: "We primarily replace, but we can review repair options if possible.", category: "Services" },
    { question: "Do you handle disposal of old windows?", answer: "Yes. We remove and dispose of old units.", category: "Process" },
    { question: "Can I be home for the install?", answer: "Yes, and we recommend someone be available for access.", category: "Scheduling" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We’ll confirm when booking.", category: "Payments" },
    { question: "Can you work on multi-story homes?", answer: "Yes. We service multi-story homes and use proper safety practices.", category: "Safety" },
    { question: "Do you offer financing?", answer: "We can share financing options if available.", category: "Pricing" },
    { question: "What if it rains on install day?", answer: "We monitor weather and will coordinate any rescheduling.", category: "Scheduling" },
    { question: "Can you replace a single window?", answer: "Yes. We handle single window and full-home projects.", category: "Services" },
    { question: "Do you fix drafts or foggy glass?", answer: "Yes. We can recommend repair or replacement after inspection.", category: "Services" }
  ],
  electrical: [
    { question: "Do you offer emergency electrical service?", answer: "Yes. We prioritize urgent safety issues.", category: "Emergency" },
    { question: "What should I do if I smell burning or see sparks?", answer: "If safe, shut off power at the breaker and call for emergency service. If there are flames or heavy smoke, call 911 first.", category: "Emergency" },
    { question: "Do you upgrade electrical panels?", answer: "Yes. We inspect your panel and recommend upgrade options.", category: "Services" },
    { question: "Do you fix outlets and lighting issues?", answer: "Yes. We repair outlets, switches, and lighting circuits.", category: "Services" },
    { question: "Do you install EV chargers?", answer: "Yes. We can install and verify proper capacity.", category: "Services" },
    { question: "Do you do whole-home rewires?", answer: "Yes. We can assess wiring and provide a plan.", category: "Services" },
    { question: "Can you troubleshoot frequent breaker trips?", answer: "Yes. We’ll diagnose the circuit and recommend fixes.", category: "Services" },
    { question: "Do you install ceiling fans?", answer: "Yes. We install and balance ceiling fans.", category: "Services" },
    { question: "Do you offer surge protection?", answer: "Yes. We can add whole-home or point-of-use protection.", category: "Services" },
    { question: "Do you handle permits?", answer: "If required, we can coordinate permits and inspections.", category: "Process" },
    { question: "Will you provide an estimate?", answer: "Yes. We review the scope and provide pricing before work begins.", category: "Pricing" },
    { question: "Do you charge a service fee?", answer: "We’ll disclose any service or diagnostic fee at scheduling.", category: "Pricing" },
    { question: "Do you work on older homes?", answer: "Yes. We can assess older wiring and upgrade safely.", category: "Services" },
    { question: "Can I be home during the work?", answer: "Yes. We recommend someone be available for access.", category: "Scheduling" },
    { question: "How soon can you come out?", answer: "We prioritize urgent safety issues and schedule the earliest slot.", category: "Scheduling" },
    { question: "Do you provide warranties?", answer: "Yes. We stand by our workmanship and materials.", category: "Warranty" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you do inspections for real estate?", answer: "Yes. We can provide inspection reports as needed.", category: "Process" },
    { question: "Can you install smart home devices?", answer: "Yes. We can install smart switches and related devices.", category: "Services" },
    { question: "Is flickering lighting a concern?", answer: "It can be. We can inspect and diagnose the cause.", category: "Safety" }
  ],
  hvac: [
    { question: "Do you offer emergency HVAC service?", answer: "Yes. We prioritize no heat or no cooling issues.", category: "Emergency" },
    { question: "What should I do if I have no heat or no cooling?", answer: "Check the thermostat and filter first; if it’s still out, we can schedule priority service.", category: "Emergency" },
    { question: "How often should I change my air filter?", answer: "Most homes check monthly and replace about every 3 months; more often with pets or heavy use.", category: "Maintenance" },
    { question: "Do you offer maintenance plans?", answer: "Yes. We provide seasonal tune-ups and priority scheduling.", category: "Maintenance" },
    { question: "Do you repair furnaces and AC units?", answer: "Yes. We repair and service most major brands.", category: "Services" },
    { question: "Do you install new systems?", answer: "Yes. We can size and install replacement systems.", category: "Services" },
    { question: "Do you work on heat pumps?", answer: "Yes. We service and install heat pumps.", category: "Services" },
    { question: "Do you handle ductwork issues?", answer: "Yes. We can inspect and improve airflow.", category: "Services" },
    { question: "Why is my system short cycling?", answer: "Short cycling can have several causes; we can diagnose and fix it.", category: "Services" },
    { question: "Do you provide estimates?", answer: "Yes. We provide pricing after reviewing the issue or scope.", category: "Pricing" },
    { question: "Do you charge a diagnostic fee?", answer: "We’ll confirm any diagnostic fee when scheduling.", category: "Pricing" },
    { question: "How soon can you come out?", answer: "We prioritize urgent issues and schedule the earliest available time.", category: "Scheduling" },
    { question: "Do I need to be home?", answer: "Yes, we recommend someone be available for access.", category: "Scheduling" },
    { question: "Do you offer indoor air quality services?", answer: "Yes. We can discuss filtration and air quality options.", category: "Services" },
    { question: "Is a noisy system normal?", answer: "Unusual noises aren’t normal. We can inspect and advise.", category: "Safety" },
    { question: "Will you clean up after service?", answer: "Yes. We leave the area clean and safe.", category: "Process" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you offer warranties?", answer: "Yes. We provide workmanship and equipment warranty details.", category: "Warranty" },
    { question: "Can you help with thermostat issues?", answer: "Yes. We can troubleshoot and replace thermostats.", category: "Services" },
    { question: "Do you service commercial units?", answer: "We can confirm commercial availability based on your needs.", category: "Coverage" }
  ],
  roofing: [
    { question: "Do you handle emergency leaks?", answer: "Yes. We can tarp and stabilize leaks quickly and schedule permanent repairs.", category: "Emergency" },
    { question: "Can you provide a temporary cover?", answer: "Yes. We can install temporary protection until full repairs are completed.", category: "Emergency" },
    { question: "Do you help with storm damage?", answer: "Yes. We inspect storm damage and provide documentation.", category: "Process" },
    { question: "Do you do roof inspections?", answer: "Yes. We offer inspections to assess condition and issues.", category: "Services" },
    { question: "Do you repair or replace roofs?", answer: "We do both. We’ll recommend the best option after inspection.", category: "Services" },
    { question: "Do you work with insurance?", answer: "We can provide documentation for insurance claims.", category: "Process" },
    { question: "How long does a roof replacement take?", answer: "Most residential roofs are completed in 1–2 days depending on size and weather.", category: "Scheduling" },
    { question: "Do you offer estimates?", answer: "Yes. We provide a detailed estimate after inspection.", category: "Pricing" },
    { question: "What roofing materials do you install?", answer: "We can install common materials like asphalt shingles and others by request.", category: "Products" },
    { question: "Do you fix flashing issues?", answer: "Yes. We repair flashing around chimneys and vents.", category: "Services" },
    { question: "Do you handle gutters?", answer: "We can inspect gutters and recommend repairs if needed.", category: "Services" },
    { question: "What is the warranty?", answer: "We provide workmanship and manufacturer warranty details.", category: "Warranty" },
    { question: "Do I need to be home?", answer: "It’s helpful but not always required. We’ll confirm access needs.", category: "Scheduling" },
    { question: "What happens if it rains?", answer: "We monitor weather and will reschedule if conditions are unsafe.", category: "Scheduling" },
    { question: "Do you do roof maintenance?", answer: "Yes. We offer maintenance and periodic inspections.", category: "Maintenance" },
    { question: "Will you remove old materials?", answer: "Yes. We handle tear-off and disposal.", category: "Process" },
    { question: "Can you fix a small leak only?", answer: "Yes. We handle small repairs and patching.", category: "Services" },
    { question: "Do you service commercial roofs?", answer: "We can confirm commercial availability based on your needs.", category: "Coverage" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "How soon can you come out?", answer: "We prioritize urgent leaks and schedule the earliest available time.", category: "Scheduling" }
  ],
  landscaping: [
    { question: "How often do you mow?", answer: "Typically weekly during peak growing season; timing can vary by weather and grass type.", category: "Maintenance" },
    { question: "Do you offer seasonal cleanups?", answer: "Yes. We schedule spring/fall cleanups and ongoing maintenance.", category: "Maintenance" },
    { question: "Can you handle irrigation issues?", answer: "Yes. We diagnose and repair irrigation systems.", category: "Services" },
    { question: "Do you offer lawn care programs?", answer: "Yes. We can provide fertilization and weed control plans.", category: "Services" },
    { question: "Do you do mulching and bed maintenance?", answer: "Yes. We can refresh mulch and maintain planting beds.", category: "Services" },
    { question: "Do you handle tree trimming?", answer: "We can handle light trimming and recommend arborists when needed.", category: "Services" },
    { question: "Can you install new landscaping?", answer: "Yes. We can design and install new landscape features.", category: "Services" },
    { question: "Do you provide estimates?", answer: "Yes. We’ll review your yard and provide a quote.", category: "Pricing" },
    { question: "How soon can you start service?", answer: "We’ll schedule the earliest available start date.", category: "Scheduling" },
    { question: "Do I need to be home?", answer: "Not always. We can service the exterior with access.", category: "Scheduling" },
    { question: "What areas do you service?", answer: "We serve the local area. Share your address and we’ll confirm.", category: "Coverage" },
    { question: "Do you handle snow removal?", answer: "We can confirm seasonal snow service availability.", category: "Services" },
    { question: "What about lawn damage or bare spots?", answer: "We can recommend overseeding or repairs.", category: "Maintenance" },
    { question: "Do you use pet-safe products?", answer: "We can discuss product options and safety guidance.", category: "Safety" },
    { question: "Can you help with drainage issues?", answer: "We can assess grading and drainage options.", category: "Services" },
    { question: "Will you haul away debris?", answer: "Yes. We remove yard waste from cleanups.", category: "Process" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you offer ongoing maintenance?", answer: "Yes. We can set up a recurring service plan.", category: "Maintenance" },
    { question: "Do you do hardscaping?", answer: "We can discuss patios, walkways, and retaining walls.", category: "Services" },
    { question: "Can you adjust service frequency?", answer: "Yes. We can tailor schedules to your needs.", category: "Scheduling" }
  ],
  cleaning: [
    { question: "Do you provide recurring cleanings?", answer: "Yes. We offer weekly, bi-weekly, and monthly plans.", category: "Maintenance" },
    { question: "Do you offer one-time or deep cleans?", answer: "Yes. We offer deep cleans and one-time services.", category: "Services" },
    { question: "Do you bring your own supplies?", answer: "Yes. We bring supplies and can use yours if requested.", category: "Services" },
    { question: "Are you pet friendly?", answer: "Yes. We use family- and pet-friendly products when possible.", category: "Process" },
    { question: "Do I need to be home?", answer: "Not always. We can clean with access instructions.", category: "Scheduling" },
    { question: "What areas do you service?", answer: "We serve the local area. Share your address and we’ll confirm.", category: "Coverage" },
    { question: "Do you clean inside appliances?", answer: "We can add inside oven or fridge cleaning by request.", category: "Services" },
    { question: "Do you do move-in or move-out cleans?", answer: "Yes. We offer move-in and move-out services.", category: "Services" },
    { question: "How long does a cleaning take?", answer: "It depends on home size and service type. We’ll estimate when booking.", category: "Scheduling" },
    { question: "Do you offer same-day service?", answer: "We’ll check availability for urgent requests.", category: "Scheduling" },
    { question: "Can I request green products?", answer: "Yes. We can use eco-friendly products by request.", category: "Products" },
    { question: "Do you clean windows?", answer: "We can clean interior windows by request.", category: "Services" },
    { question: "Do you clean carpets?", answer: "We can confirm carpet cleaning availability or recommend a specialist.", category: "Services" },
    { question: "Do you handle laundry?", answer: "We can discuss add-on laundry services if available.", category: "Services" },
    { question: "What is included in a standard clean?", answer: "We’ll review the checklist of rooms and tasks before scheduling.", category: "Process" },
    { question: "Will you provide an estimate?", answer: "Yes. We provide pricing based on home size and service type.", category: "Pricing" },
    { question: "Do you have minimums?", answer: "We’ll share any minimum service requirements when booking.", category: "Pricing" },
    { question: "Do you guarantee your work?", answer: "Yes. Let us know if anything was missed and we’ll make it right.", category: "Warranty" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you have background-checked staff?", answer: "We can share our hiring and screening process.", category: "Process" }
  ],
  pest_control: [
    { question: "What pests do you treat?", answer: "We handle common household pests like ants, roaches, spiders, rodents, and seasonal invaders. Specialized pests may require a separate inspection.", category: "Services" },
    { question: "Do you offer one-time and recurring service?", answer: "Yes. We can do a one-time treatment or set up a recurring plan.", category: "Services" },
    { question: "How often do you recommend service?", answer: "Many homes use quarterly plans, but it depends on pest activity and the property.", category: "Maintenance" },
    { question: "How should I prepare before treatment?", answer: "We’ll provide prep steps, but usually we ask for clear access and removal of food and pet bowls.", category: "Preparation" },
    { question: "Do I need to leave the home during treatment?", answer: "Usually no for routine treatments, but it depends on the product used. We’ll provide instructions.", category: "Safety" },
    { question: "When can I re-enter after treatment?", answer: "Re-entry timing depends on product label directions. We’ll give the exact interval.", category: "Safety" },
    { question: "Is pest control safe for kids and pets?", answer: "We prioritize reduced-risk methods and provide safety instructions and re-entry timing.", category: "Safety" },
    { question: "Do you use integrated pest management?", answer: "Yes. We focus on prevention plus targeted treatments.", category: "Process" },
    { question: "What can I do to prevent pests between visits?", answer: "Seal gaps, reduce moisture, store food in sealed containers, and remove standing water.", category: "Prevention" },
    { question: "Will I still see pests after treatment?", answer: "Some activity can be normal at first. We’ll explain what to expect.", category: "Process" },
    { question: "Do you provide follow-up visits?", answer: "Yes. Follow-ups are common to confirm results.", category: "Process" },
    { question: "Do you handle rodents?", answer: "Yes. We use inspection, trapping/baiting, and exclusion.", category: "Services" },
    { question: "How long does rodent control take?", answer: "It depends on severity and conditions; we’ll set expectations after inspection.", category: "Process" },
    { question: "Do you offer termite inspections?", answer: "Yes. Termites typically require a separate inspection and plan.", category: "Services" },
    { question: "Do you treat bed bugs or fleas?", answer: "Yes, but those require specialized prep and a specific plan.", category: "Services" },
    { question: "What if I see pests between visits?", answer: "Contact us and we’ll assess whether a touch-up is needed.", category: "Support" },
    { question: "Do you guarantee your service?", answer: "Many plans include a warranty or re-service window. We’ll confirm details.", category: "Warranty" },
    { question: "Will you treat inside and outside?", answer: "It depends on the issue. We’ll recommend the best approach.", category: "Services" },
    { question: "Do I need to be home for service?", answer: "Not always. Exterior service usually doesn’t require you home.", category: "Scheduling" },
    { question: "Will you seal entry points?", answer: "We identify entry points and recommend sealing locations.", category: "Prevention" },
    { question: "What should I do with pet food and water?", answer: "Remove food and water from treatment areas until it’s safe to return them.", category: "Preparation" },
    { question: "Do you handle mosquitoes or outdoor pests?", answer: "Yes. We can provide seasonal treatments and guidance.", category: "Services" },
    { question: "Are the products odorless?", answer: "Most products have minimal odor, but it varies. We’ll set expectations.", category: "Process" },
    { question: "Can I do this myself instead of hiring a pro?", answer: "DIY can work for minor issues, but recurring problems often need professional care.", category: "Process" }
  ],
  garage_door: [
    { question: "Is it safe to use the door with a broken spring?", answer: "No. Broken springs are dangerous; avoid using the door and call us.", category: "Safety" },
    { question: "Do you repair broken springs?", answer: "Yes. We replace springs and tune up doors.", category: "Services" },
    { question: "Do you install or repair openers?", answer: "Yes. We repair and install new openers.", category: "Services" },
    { question: "My door is off track. Can you fix it?", answer: "Yes. We can realign and repair off-track doors.", category: "Services" },
    { question: "Do you offer same-day service?", answer: "We prioritize stuck or unsafe doors and schedule quickly.", category: "Scheduling" },
    { question: "Why is my door making noise?", answer: "Noises often indicate wear; we can inspect and service.", category: "Maintenance" },
    { question: "Do you service commercial doors?", answer: "We can confirm commercial availability based on your needs.", category: "Coverage" },
    { question: "Can you replace panels?", answer: "Yes. We can replace damaged panels if compatible.", category: "Services" },
    { question: "Do you install new doors?", answer: "Yes. We install new garage doors and hardware.", category: "Services" },
    { question: "Do you provide estimates?", answer: "Yes. We’ll provide pricing after inspection.", category: "Pricing" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you offer warranties?", answer: "Yes. We provide workmanship and product warranty details.", category: "Warranty" },
    { question: "Can you add keypads or smart openers?", answer: "Yes. We can install keypads and smart openers.", category: "Services" },
    { question: "Do I need to be home?", answer: "Yes, we recommend someone be available for access.", category: "Scheduling" },
    { question: "How long does a repair take?", answer: "Many repairs are completed in one visit.", category: "Scheduling" },
    { question: "Is a broken cable dangerous?", answer: "Yes. Avoid using the door and let us inspect.", category: "Safety" },
    { question: "Do you perform tune-ups?", answer: "Yes. We can lubricate and adjust doors and hardware.", category: "Maintenance" },
    { question: "Can you fix remotes?", answer: "Yes. We can troubleshoot remotes and sensors.", category: "Services" },
    { question: "Will you haul away old doors?", answer: "Yes. We remove and dispose of old doors.", category: "Process" },
    { question: "Do you service rental properties?", answer: "Yes. We can coordinate access with property managers.", category: "Process" }
  ],
  general_contractor: [
    { question: "Do you do estimates?", answer: "Yes. We review scope and provide a detailed estimate.", category: "Pricing" },
    { question: "Do you handle permits?", answer: "Yes. We coordinate permits and required inspections for the project.", category: "Process" },
    { question: "Can you provide a project timeline?", answer: "Yes. We provide a timeline after scope review.", category: "Scheduling" },
    { question: "Do you handle remodels and additions?", answer: "Yes. We handle a range of remodeling and addition projects.", category: "Services" },
    { question: "Do you do kitchen and bath renovations?", answer: "Yes. We provide full-service kitchen and bath remodels.", category: "Services" },
    { question: "Do you work with subcontractors?", answer: "Yes. We coordinate licensed trades as needed.", category: "Process" },
    { question: "Can you help with design?", answer: "We can work from your plans or connect you with design resources.", category: "Process" },
    { question: "What areas do you service?", answer: "We serve the local area. Share your address and we’ll confirm.", category: "Coverage" },
    { question: "How soon can you start?", answer: "Start dates depend on scope and schedule. We’ll confirm availability.", category: "Scheduling" },
    { question: "Do you offer fixed-price contracts?", answer: "We can discuss fixed-price or cost-plus options based on scope.", category: "Pricing" },
    { question: "Do you provide warranty?", answer: "Yes. We provide workmanship warranty details.", category: "Warranty" },
    { question: "Do you help with budgeting?", answer: "Yes. We can align scope with your budget goals.", category: "Pricing" },
    { question: "Do you handle material selection?", answer: "Yes. We can guide selections and procurement.", category: "Process" },
    { question: "Do you do small repairs?", answer: "We can review your needs and confirm fit.", category: "Services" },
    { question: "Do you service commercial projects?", answer: "We can confirm commercial availability based on your scope.", category: "Coverage" },
    { question: "Do I need to be home for work?", answer: "We can discuss access and communication preferences.", category: "Process" },
    { question: "How do change orders work?", answer: "We document changes and pricing before proceeding.", category: "Process" },
    { question: "Can you help with inspections?", answer: "Yes. We schedule and coordinate required inspections.", category: "Process" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Do you provide progress updates?", answer: "Yes. We keep you informed throughout the project.", category: "Process" }
  ],
  locksmith: [
    { question: "Do you offer emergency lockout service?", answer: "Yes. We provide emergency lockout service.", category: "Emergency" },
    { question: "What is the difference between rekeying and replacing?", answer: "Rekeying changes the key without replacing the lock; replacement is best for damaged or upgraded hardware.", category: "Services" },
    { question: "Can you rekey locks?", answer: "Yes. We rekey residential and commercial locks.", category: "Services" },
    { question: "Do you install new locks?", answer: "Yes. We install deadbolts and other lock hardware.", category: "Services" },
    { question: "Do you handle car lockouts?", answer: "We can confirm auto lockout availability when you call.", category: "Services" },
    { question: "Can you cut new keys?", answer: "Yes. We can duplicate keys or create new ones.", category: "Services" },
    { question: "Do you install smart locks?", answer: "Yes. We install and set up smart locks.", category: "Services" },
    { question: "How quickly can you arrive?", answer: "We prioritize lockouts and schedule the earliest available time.", category: "Scheduling" },
    { question: "Do you charge a trip fee?", answer: "We’ll confirm any service fee when scheduling.", category: "Pricing" },
    { question: "Do you provide estimates?", answer: "Yes. We provide pricing after understanding the issue.", category: "Pricing" },
    { question: "Do you service businesses?", answer: "Yes. We service residential and commercial properties.", category: "Coverage" },
    { question: "Can you repair broken locks?", answer: "Yes. We repair or replace damaged locks.", category: "Services" },
    { question: "What should I do if my key broke in the lock?", answer: "Avoid forcing it. We can extract it safely.", category: "Safety" },
    { question: "Do I need proof of ownership?", answer: "Yes. We verify ownership for security.", category: "Process" },
    { question: "Do you offer master key systems?", answer: "We can discuss master key options for businesses.", category: "Services" },
    { question: "Do you install door hardware?", answer: "Yes. We install and adjust door hardware.", category: "Services" },
    { question: "Do you offer warranties?", answer: "Yes. We provide workmanship details on request.", category: "Warranty" },
    { question: "What payment methods do you accept?", answer: "We accept common payment methods. We can confirm when booking.", category: "Payments" },
    { question: "Can you change locks after a move?", answer: "Yes. Rekeying or replacing is recommended after moving.", category: "Safety" },
    { question: "Do you handle emergency after-hours calls?", answer: "We can confirm after-hours availability when you call.", category: "Emergency" }
  ]
};

function buildIndustryPrompt({ companyName, helpType, proRole, technicalType }) {
  return `# ROLE
<role>
You are Sarah, the friendly receptionist at ${companyName}. You answer phone calls 24/7. A customer is calling because they need ${helpType} help. Your job is to collect their information so the team can follow up.
You are a receptionist, NOT a ${proRole}. Never ask technical questions. Just gather info and schedule a callback.
</role>

# CONVERSATION STYLE
<style>
- Warm, conversational, professional but casual
- Use periods, not exclamation points
- Keep a steady, calm tone even if the caller sounds urgent
- Keep responses to one or two short sentences max
- Use the caller's first name only once or twice — not every turn
</style>

# EXAMPLES OF WHAT TO SAY AND NOT SAY
<examples>
- Avoid: "Is it actively leaking right now?" (when they already said it's leaking)
- Use: "Thanks for letting me know — I’ll take your info so we can get help scheduled."

- Avoid: Spelling back both first AND last name
- Use: Only confirm first name spelling if ambiguous. Skip last name unless it sounds very unusual.

- Avoid: Asking a question the caller already answered
- Use: Acknowledge what they told you and move to the next thing you need

- Avoid: Ignoring a direct question from the caller
- Use: Always answer the caller's question before continuing your script

- Avoid: "Do you have any other questions?" then immediately launching into the closing
- Use: Ask, wait for their answer, THEN close

- Avoid: "Got it — this evening." [pause] "Hey John, just checking in — what time works?"
- Use: "Got it — this evening works. What time would you prefer?"

- Avoid: Reading back the full address in the closing when it was already confirmed earlier
- Use: Keep the closing brief — just reference the time and say someone will call to confirm

- Avoid: "Just checking in" or "just following up" language during the call
- Use: Ask your next question directly and naturally
</examples>

# SCRIPT FLOW
<script>
Follow this order, but skip anything the caller already provided:

1. Caller's name — confirm first name spelling only if it sounds ambiguous (Jon/John, Sean/Shawn, etc.)
2. Best callback number — read it back in groups: three digits... three digits... four digits
3. Urgency — ONLY ask if they haven't already indicated it. If they said "leaking" or "flooding," it's already urgent — just acknowledge it and move on.
4. Service address — read it back to confirm. Make sure the zip code is five digits. If you only caught four or fewer, ask for the full zip.
5. Preferred timing — when do they want someone to come out. If they say a general time like "this evening," ask what time works best in the same message.

IMPORTANT: If the caller already told you something (like their problem or that it's urgent), do NOT ask about it again. Just acknowledge it naturally and move to the next item you still need.
</script>

# KEY RULES
<rules>
- Send ONE message per turn. Never send two consecutive messages. This is critical — combine your acknowledgment and next question into a single response every time.
- Ask ONE question at a time. Wait for the answer before continuing.
- If you need to confirm something AND ask a new question, confirm first, wait for the response, then ask.
- ALWAYS answer the caller's questions — never skip or ignore them. If you don't know the answer, say "Great question — I'll make sure the technician covers that when they call."
- Never repeat back information that the caller already confirmed earlier in the call. Once something is confirmed, move on.
- Never use "checking in" or "just following up" language during the call — you are actively collecting info, not following up.
- NEVER mention websites, apps, or technology
- If asked "are you AI": "I'm Sarah, ${companyName}'s automated assistant." Then continue naturally.
- NEVER make up information
- NEVER ask technical ${technicalType} questions
</rules>

# EMERGENCIES
<emergencies>
If the caller mentions active leaking, flooding, no water, or gas smell — acknowledge calmly and prioritize the request:
- "Thanks for letting me know — we’ll prioritize this."
- "Understood — I’ll take your info so we can get help scheduled."
- "Got it — we’ll make this a priority and get someone out."

Gas smell: "Please leave the home immediately and call 911 first. Once you're safe, call us back."
</emergencies>

# PRICING
<pricing>
If asked about cost: "Every job is a little different — the technician will give you an accurate quote on-site. We always get approval before doing any work."
</pricing>

# BEFORE CLOSING
<pre_close>
Once you've collected everything, ask: "Do you have any other questions, or anything else I can help with?"
Wait for their answer. If they ask something, answer it. Only move to closing after they say they're all set.
</pre_close>

# CLOSING
<closing>
Keep the closing SHORT. Do not re-read information that was already confirmed earlier in the call.

If a specific time was requested:
"I've got you penciled in for [time]. Someone from our team will call you at [callback number] to confirm the details. Thanks for calling ${companyName}, [name] — talk to you soon."

If no specific time:
"Someone from our team will call you back at [callback number] within 20 minutes. Thanks for calling ${companyName}, [name] — talk to you soon."
</closing>`;
}

const DEFAULT_PROMPTS = {
  plumbing: buildIndustryPrompt({
    companyName: "Bob's Plumbing",
    helpType: "plumbing",
    proRole: "plumber",
    technicalType: "plumbing"
  }),
  window_installers: buildIndustryPrompt({
    companyName: "Bob's Window Installers",
    helpType: "window installation",
    proRole: "window installer",
    technicalType: "window installation"
  }),
  electrical: buildIndustryPrompt({
    companyName: "Bob's Electrical",
    helpType: "electrical",
    proRole: "electrician",
    technicalType: "electrical"
  }),
  hvac: buildIndustryPrompt({
    companyName: "Bob's HVAC",
    helpType: "HVAC",
    proRole: "HVAC technician",
    technicalType: "HVAC"
  }),
  roofing: buildIndustryPrompt({
    companyName: "Bob's Roofing",
    helpType: "roofing",
    proRole: "roofer",
    technicalType: "roofing"
  }),
  landscaping: buildIndustryPrompt({
    companyName: "Bob's Landscaping",
    helpType: "landscaping",
    proRole: "landscaper",
    technicalType: "landscaping"
  }),
  cleaning: buildIndustryPrompt({
    companyName: "Bob's Cleaning",
    helpType: "cleaning",
    proRole: "cleaner",
    technicalType: "cleaning"
  }),
  pest_control: buildIndustryPrompt({
    companyName: "Bob's Pest Control",
    helpType: "pest control",
    proRole: "pest control technician",
    technicalType: "pest control"
  }),
  garage_door: buildIndustryPrompt({
    companyName: "Bob's Garage Door",
    helpType: "garage door",
    proRole: "garage door technician",
    technicalType: "garage door"
  }),
  general_contractor: buildIndustryPrompt({
    companyName: "Bob's General Contracting",
    helpType: "general contracting",
    proRole: "contractor",
    technicalType: "general contracting"
  }),
  locksmith: buildIndustryPrompt({
    companyName: "Bob's Locksmith",
    helpType: "locksmith",
    proRole: "locksmith",
    technicalType: "locksmith"
  })
};

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const mode = String(req.query?.mode || "").toLowerCase();
    const industryKey = getIndustryKey(req);

    if (req.method === "GET") {
      if (mode === "prompt" && industryKey) {
        const row = await pool.query(
          `SELECT industry_key, prompt, updated_at
           FROM industry_prompts
           WHERE industry_key = $1`,
          [industryKey]
        );
        return res.status(200).json({ prompt: row.rows[0] || null });
      }

      if (mode === "faqs" && industryKey) {
        const rows = await pool.query(
          `SELECT id, question, answer, category
           FROM industry_faqs
           WHERE industry_key = $1
           ORDER BY id ASC`,
          [industryKey]
        );
        return res.status(200).json({ faqs: rows.rows });
      }

      const rows = await pool.query(
        `SELECT key, name, active
         FROM industries
         ORDER BY name ASC`
      );
      return res.status(200).json({ industries: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};

      if (mode === "industry") {
        const key = String(body.key || "").trim();
        const name = String(body.name || "").trim();
        const active = body.active !== false;
        if (!key || !name) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industries (key, name, active)
           VALUES ($1, $2, $3)
           ON CONFLICT (key)
           DO UPDATE SET name = EXCLUDED.name,
                         active = EXCLUDED.active`,
          [key, name, active]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "clone") {
        const sourceKey = String(body.sourceKey || "").trim();
        const targetKey = String(body.targetKey || "").trim();
        const replace = body.replace !== false;
        if (!sourceKey || !targetKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const sourceExists = await pool.query(`SELECT 1 FROM industries WHERE key = $1`, [sourceKey]);
        const targetExists = await pool.query(`SELECT 1 FROM industries WHERE key = $1`, [targetKey]);
        if (!sourceExists.rowCount || !targetExists.rowCount) {
          return res.status(404).json({ error: "industry_not_found" });
        }
        if (replace) {
          await pool.query(`DELETE FROM industry_faqs WHERE industry_key = $1`, [targetKey]);
          await pool.query(`DELETE FROM industry_prompts WHERE industry_key = $1`, [targetKey]);
        }
        await pool.query(
          `INSERT INTO industry_faqs (industry_key, question, answer, category)
           SELECT $1, question, answer, category
           FROM industry_faqs
           WHERE industry_key = $2`,
          [targetKey, sourceKey]
        );
        await pool.query(
          `INSERT INTO industry_prompts (industry_key, prompt)
           SELECT $1, prompt
           FROM industry_prompts
           WHERE industry_key = $2
           ON CONFLICT (industry_key)
           DO UPDATE SET prompt = EXCLUDED.prompt,
                         updated_at = NOW()`,
          [targetKey, sourceKey]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "applyprompt") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const promptRow = await pool.query(
          `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
          [industryKey]
        );
        if (!promptRow.rowCount) {
          return res.status(404).json({ error: "missing_prompt" });
        }
        const prompt = promptRow.rows[0].prompt;
        const updated = await pool.query(
          `UPDATE agents
           SET tenant_prompt_override = $1,
               system_prompt = $1,
               updated_at = NOW()
           WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $2)
           RETURNING tenant_key, agent_name, company_name`,
          [prompt, industryKey]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
             SELECT tenant_key, agent_name, company_name, $2, $2
             FROM agents
             WHERE tenant_key IN (SELECT tenant_key FROM tenants WHERE industry = $1)`,
            [industryKey, prompt]
          );
        }
        return res.status(200).json({ ok: true, updated: updated.rowCount });
      }

      if (mode === "importprompt") {
        const targetTenant = String(body.tenantKey || "").trim();
        if (!industryKey || !targetTenant) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const promptRow = await pool.query(
          `SELECT prompt FROM industry_prompts WHERE industry_key = $1`,
          [industryKey]
        );
        if (!promptRow.rowCount) {
          return res.status(404).json({ error: "missing_prompt" });
        }
        const prompt = promptRow.rows[0].prompt;
        const updated = await pool.query(
          `UPDATE agents
           SET tenant_prompt_override = $1,
               system_prompt = $1,
               updated_at = NOW()
           WHERE tenant_key = $2
           RETURNING tenant_key, agent_name, company_name`,
          [prompt, targetTenant]
        );
        if (updated.rowCount) {
          await pool.query(
            `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
             SELECT tenant_key, agent_name, company_name, $2, $2
             FROM agents
             WHERE tenant_key = $1`,
            [targetTenant, prompt]
          );
        }
        return res.status(200).json({ ok: true, updated: updated.rowCount || 0 });
      }

      if (mode === "applyfaqs") {
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const faqs = await pool.query(
          `SELECT question, answer, category
           FROM industry_faqs
           WHERE industry_key = $1
           ORDER BY id ASC`,
          [industryKey]
        );
        if (!faqs.rowCount) {
          return res.status(404).json({ error: "missing_faqs" });
        }
        const tenants = await pool.query(
          `SELECT tenant_key FROM tenants WHERE industry = $1`,
          [industryKey]
        );
        for (const tenant of tenants.rows) {
          await pool.query(
            `DELETE FROM faqs
             WHERE tenant_key = $1 AND is_industry_default = true AND industry = $2`,
            [tenant.tenant_key, industryKey]
          );
          for (const faq of faqs.rows) {
            await pool.query(
              `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry)
               VALUES ($1, $2, $3, $4, true, true, $5)`,
              [tenant.tenant_key, faq.question, faq.answer, faq.category, industryKey]
            );
          }
        }
        return res.status(200).json({ ok: true, updated: tenants.rowCount });
      }

      if (mode === "importfaqs") {
        const targetTenant = String(body.tenantKey || "").trim();
        if (!industryKey || !targetTenant) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const faqs = await pool.query(
          `SELECT question, answer, category
           FROM industry_faqs
           WHERE industry_key = $1
           ORDER BY id ASC`,
          [industryKey]
        );
        if (!faqs.rowCount) {
          return res.status(404).json({ error: "missing_faqs" });
        }
        await pool.query(
          `DELETE FROM faqs
           WHERE tenant_key = $1 AND is_industry_default = true AND industry = $2`,
          [targetTenant, industryKey]
        );
        for (const faq of faqs.rows) {
          await pool.query(
            `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_industry_default, industry)
             VALUES ($1, $2, $3, $4, true, true, $5)`,
            [targetTenant, faq.question, faq.answer, faq.category, industryKey]
          );
        }
        return res.status(200).json({ ok: true, updated: 1 });
      }

      if (mode === "seeddefaults") {
        const industryKey = String(body.industryKey || "").trim();
        if (!industryKey) {
          return res.status(400).json({ error: "missing_fields" });
        }
        const inserted = await fetchSeedDefaults(pool, industryKey, DEFAULT_FAQS, DEFAULT_PROMPTS);
        return res.status(200).json({ ok: true, inserted });
      }

      if (mode === "seedall") {
        const rows = await pool.query(`SELECT key FROM industries ORDER BY key ASC`);
        const summary = [];
        for (const row of rows.rows) {
          const resp = await fetchSeedDefaults(pool, row.key, DEFAULT_FAQS, DEFAULT_PROMPTS, {
            forcePrompt: true,
            forceFaqs: true
          });
          summary.push({ industryKey: row.key, inserted: resp });
        }
        return res.status(200).json({ ok: true, count: rows.rowCount, summary });
      }

      if (mode === "prompt") {
        const prompt = String(body.prompt || "").trim();
        if (!industryKey || !prompt) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industry_prompts (industry_key, prompt)
           VALUES ($1, $2)
           ON CONFLICT (industry_key)
           DO UPDATE SET prompt = EXCLUDED.prompt,
                         updated_at = NOW()`,
          [industryKey, prompt]
        );
        return res.status(200).json({ ok: true });
      }

      if (mode === "faqs") {
        const question = String(body.question || "").trim();
        const answer = String(body.answer || "").trim();
        const category = String(body.category || "General").trim() || "General";
        if (!industryKey || !question || !answer) {
          return res.status(400).json({ error: "missing_fields" });
        }
        await pool.query(
          `INSERT INTO industry_faqs (industry_key, question, answer, category)
           VALUES ($1, $2, $3, $4)`,
          [industryKey, question, answer, category]
        );
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_mode" });
    }

    if (req.method === "DELETE") {
      if (mode === "faqs") {
        const id = Number(req.query?.id || 0);
        if (!id) {
          return res.status(400).json({ error: "missing_id" });
        }
        await pool.query(`DELETE FROM industry_faqs WHERE id = $1`, [id]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "unsupported_mode" });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "admin_industries_error", message: err?.message || "unknown" });
  }
}
