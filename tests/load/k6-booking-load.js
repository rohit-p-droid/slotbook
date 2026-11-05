import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },  // Ramp up to 20 users
    { duration: '30s', target: 50 },  // Sustain at 50 users
    { duration: '10s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<150'], // 95% of requests must complete below 150ms
    http_req_failed: ['rate<0.05'],   // Less than 5% network/server failure
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // 1. Fetch available slots
  const slotsRes = http.get(`${BASE_URL}/api/hosts/alex/events/quick-chat/slots?tz=UTC`, {
    headers: { 'Accept': 'application/json' },
  });

  check(slotsRes, {
    'slots returned 200': (r) => r.status === 200,
    'slots list is array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.slots);
      } catch (e) {
        return false;
      }
    },
  });

  const slotsData = JSON.parse(slotsRes.body);
  if (!slotsData.slots || slotsData.slots.length === 0) {
    sleep(1);
    return;
  }

  // Pick an available slot
  const randomSlot = slotsData.slots[Math.floor(Math.random() * slotsData.slots.length)];
  const idempotencyKey = `k6_${__VU}_${__ITER}_${Date.now()}`;

  // 2. Hold the slot
  const holdPayload = JSON.stringify({
    host_slug: 'alex',
    event_slug: 'quick-chat',
    slot_start: randomSlot.slot_start,
    slot_end: randomSlot.slot_end,
  });

  const holdRes = http.post(`${BASE_URL}/api/holds`, holdPayload, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
  });

  check(holdRes, {
    'hold status is 201 or 409 conflict': (r) => r.status === 201 || r.status === 409,
  });

  // 3. If hold succeeded, confirm it
  if (holdRes.status === 201) {
    const holdData = JSON.parse(holdRes.body);
    const confirmPayload = JSON.stringify({
      guest_name: `k6 User ${__VU}`,
      guest_email: `k6_user_${__VU}_${__ITER}@example.com`,
    });

    const confirmRes = http.post(`${BASE_URL}/api/holds/${holdData.id}/confirm`, confirmPayload, {
      headers: { 'Content-Type': 'application/json' },
    });

    check(confirmRes, {
      'confirm status is 200': (r) => r.status === 200,
      'booking token generated': (r) => {
        try {
          return Boolean(JSON.parse(r.body).booking_token);
        } catch (e) {
          return false;
        }
      },
    });
  }

  sleep(0.5);
}
