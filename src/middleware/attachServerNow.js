/**
 * Adds data.serverNow (ISO) to successful JSON envelopes so clients can
 * align countdowns with the same clock used for capsule unlock checks.
 */
export default function attachServerNow(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (
      body &&
      typeof body === 'object' &&
      body.success === true &&
      body.data &&
      typeof body.data === 'object' &&
      !Array.isArray(body.data)
    ) {
      body.data.serverNow = new Date().toISOString();
    }

    return originalJson(body);
  };

  next();
}
