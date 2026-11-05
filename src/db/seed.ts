import { pool, withTransaction } from './index';

async function seed() {
  console.log('🌱 Seeding database...');

  await withTransaction(async (client) => {
    // 1. Create or get Demo Host
    const hostRes = await client.query(
      `INSERT INTO hosts (name, slug, email, timezone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name, email = EXCLUDED.email, timezone = EXCLUDED.timezone
       RETURNING id, name, slug, email, timezone`,
      ['Alex Rivers', 'alex', 'alex@example.com', 'America/New_York']
    );
    const host = hostRes.rows[0];
    console.log(`👤 Seeded Host: ${host.name} (@${host.slug}) [${host.timezone}]`);

    // 2. Create Event Type 1: 1-on-1 Quick Chat
    const event1Res = await client.query(
      `INSERT INTO event_types (
        host_id, title, slug, description, duration_minutes, capacity,
        buffer_before_minutes, buffer_after_minutes, min_notice_hours, booking_horizon_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (host_id, slug) DO UPDATE
      SET title = EXCLUDED.title,
          description = EXCLUDED.description,
          duration_minutes = EXCLUDED.duration_minutes,
          capacity = EXCLUDED.capacity,
          buffer_before_minutes = EXCLUDED.buffer_before_minutes,
          buffer_after_minutes = EXCLUDED.buffer_after_minutes,
          min_notice_hours = EXCLUDED.min_notice_hours,
          booking_horizon_days = EXCLUDED.booking_horizon_days
      RETURNING id, title, slug, capacity`,
      [
        host.id,
        '30-min Quick Chat',
        'quick-chat',
        'A focused 1-on-1 discovery call to discuss ideas, collaboration, or code architecture.',
        30,
        1,  // Capacity 1
        10, // Buffer before
        10, // Buffer after
        2,  // Min notice (2h)
        30  // Horizon (30d)
      ]
    );
    console.log(`📅 Seeded Event Type 1: ${event1Res.rows[0].title} (slug: ${event1Res.rows[0].slug}, capacity: ${event1Res.rows[0].capacity})`);

    // 3. Create Event Type 2: Group Tech Workshop
    const event2Res = await client.query(
      `INSERT INTO event_types (
        host_id, title, slug, description, duration_minutes, capacity,
        buffer_before_minutes, buffer_after_minutes, min_notice_hours, booking_horizon_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (host_id, slug) DO UPDATE
      SET title = EXCLUDED.title,
          description = EXCLUDED.description,
          duration_minutes = EXCLUDED.duration_minutes,
          capacity = EXCLUDED.capacity,
          buffer_before_minutes = EXCLUDED.buffer_before_minutes,
          buffer_after_minutes = EXCLUDED.buffer_after_minutes,
          min_notice_hours = EXCLUDED.min_notice_hours,
          booking_horizon_days = EXCLUDED.booking_horizon_days
      RETURNING id, title, slug, capacity`,
      [
        host.id,
        'Team Tech Workshop',
        'tech-workshop',
        'Interactive group architecture workshop with up to 4 participants.',
        60,
        4,  // Capacity 4 (group session)
        15, // Buffer before
        15, // Buffer after
        4,  // Min notice (4h)
        30  // Horizon (30d)
      ]
    );
    console.log(`👥 Seeded Event Type 2: ${event2Res.rows[0].title} (slug: ${event2Res.rows[0].slug}, capacity: ${event2Res.rows[0].capacity})`);

    // 4. Seed Weekly Availability: Mon-Fri, split windows 09:00-12:00 and 13:00-17:00
    await client.query('DELETE FROM host_availabilities WHERE host_id = $1', [host.id]);
    for (let day = 1; day <= 5; day++) {
      // Morning window
      await client.query(
        `INSERT INTO host_availabilities (host_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [host.id, day, '09:00:00', '12:00:00']
      );
      // Afternoon window
      await client.query(
        `INSERT INTO host_availabilities (host_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [host.id, day, '13:00:00', '17:00:00']
      );
    }
    console.log('⏰ Seeded Weekly Availability (Mon-Fri 09:00-12:00, 13:00-17:00)');

    // 5. Seed Date Overrides
    await client.query('DELETE FROM host_overrides WHERE host_id = $1', [host.id]);
    // Date off in 7 days
    const nextWeekDate = new Date();
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const dateOffStr = nextWeekDate.toISOString().split('T')[0];

    await client.query(
      `INSERT INTO host_overrides (host_id, override_date, is_unavailable)
       VALUES ($1, $2, TRUE)`,
      [host.id, dateOffStr]
    );

    // Custom hours in 10 days (10:00 - 14:00)
    const customHoursDate = new Date();
    customHoursDate.setDate(customHoursDate.getDate() + 10);
    const customDateStr = customHoursDate.toISOString().split('T')[0];

    await client.query(
      `INSERT INTO host_overrides (host_id, override_date, is_unavailable, start_time, end_time)
       VALUES ($1, $2, FALSE, $3, $4)`,
      [host.id, customDateStr, '10:00:00', '14:00:00']
    );
    console.log(`📆 Seeded Overrides: ${dateOffStr} (Day Off), ${customDateStr} (10:00-14:00)`);
  });

  console.log('✨ Database seeding complete!');
}

if (process.argv[1] === process.argv[1]) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    });
}

export { seed };
