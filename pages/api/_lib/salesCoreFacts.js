// This canonical projection is used verbatim by both the Sales prompt and rep UI.
export function salesCoreFacts(bundle = {}) {
  if (Array.isArray(bundle.core_facts)) return bundle.core_facts;
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const facts = [];
  const add = (category, label, value) => { const sentence = clean(value); if (sentence) facts.push({ category, label, sentence }); };
  add('services', 'Services', Array.isArray(bundle.topServices) ? bundle.topServices.join(', ') : '');
  add('service_area', 'Service area', bundle.serviceArea);
  add('hours', 'Hours', bundle.hours);
  add('after_hours', 'After hours', bundle.emergencyAvailability);
  for (const fact of (bundle.contactFacts || [])) add('contact', 'Contact', fact);
  return facts;
}
export function salesSuggestedAsks(facts = []) {
  const questions = { hours: 'What are your hours?', service_area: 'Do you serve my area?', services: 'What services do you offer?' };
  const result = Object.entries(questions).filter(([category]) => facts.some(f => f.category === category)).map(([category,text]) => ({category,text,pitch:false}));
  if (!facts.some(f => f.category === 'after_hours')) result.push({category:'after_hours',text:'What happens when I call after hours?',pitch:true});
  return result;
}
