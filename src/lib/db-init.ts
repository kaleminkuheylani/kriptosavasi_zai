#!/usr/bin/env bun
/**
 * Database Initialization Script
 * 
 * Kullanım:
 *   bun run db:init
 * 
 * Bu script supabase/schema.sql dosyasını çalıştırarak
 * veritabanı tablolarını oluşturur.
 */

import { sql } from '@vercel/postgres';
import * as fs from 'fs';
import * as path from 'path';

async function initDatabase() {
  console.log('🚀 Veritabanı başlatılıyor...\n');

  try {
    // SQL schema dosyasını oku
    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      console.error('❌ schema.sql dosyası bulunamadı:', schemaPath);
      process.exit(1);
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    console.log('📄 SQL schema okundu');
    console.log('📊 Tablolar oluşturuluyor...\n');

    // SQL'i çalıştır
    // NOT: Supabase/Vercel Postgres çoklu statement'ı destekler
    await sql.query(schema);

    console.log('✅ Veritabanı tabloları başarıyla oluşturuldu!\n');
    
    // Tabloları doğrula
    console.log('📋 Oluşturulan tablolar:');
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;
    
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    console.log('\n🎉 Veritabanı hazır!');

  } catch (error) {
    console.error('❌ Veritabanı başlatma hatası:', error);
    process.exit(1);
  }

  process.exit(0);
}

initDatabase();
