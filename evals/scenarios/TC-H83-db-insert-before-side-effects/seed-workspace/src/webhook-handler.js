export async function handleWebhookEvent(event, db, dedup) {
  const eventId = event.id;

  // Mark as processed FIRST (wrong — runs even if insert fails)
  await dedup.markProcessed(eventId);

  // Then insert into DB
  await db.events.insert({
    id: eventId,
    type: event.type,
    payload: event.payload,
    receivedAt: new Date(),
  });

  return { status: 'ok' };
}
