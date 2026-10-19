import type { Request, Response } from 'express';

export async function handleWebhook(req: Request, res: Response) {
  const { event, payload } = req.body;
  // TODO: process webhook event
  res.json({ received: true, event });
}
