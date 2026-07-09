import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const parts = await sql(
    'SELECT id, name, slug, is_active, created_at FROM parts ORDER BY created_at DESC',
  );
  console.log('PARTS:');
  for (const p of parts) {
    console.log(`  ${p.id} | ${p.name} | active=${p.is_active} | ${p.created_at}`);
  }
  const imgs = await sql('SELECT part_id, image_url, delete_url, sort_order FROM part_images');
  console.log('\nIMAGES:');
  for (const i of imgs) {
    console.log(`  part=${i.part_id} sort=${i.sort_order}`);
    console.log(`    url= ${i.image_url}`);
    console.log(`    del= ${i.delete_url}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
