begin;

create table public.cruise_cafe_ocr_extractions_v2 (
  id uuid primary key default gen_random_uuid(),
  cruise_id uuid not null references public.cruises_v2(id) on delete cascade,
  source_url text not null,
  source_image_url text not null,
  extracted_text text not null,
  confidence numeric(5,2),
  created_at timestamptz not null default now()
);

create index cruise_cafe_ocr_extractions_v2_cruise_id_created_at_idx
  on public.cruise_cafe_ocr_extractions_v2 (cruise_id, created_at desc);

alter table public.cruise_cafe_ocr_extractions_v2 enable row level security;
revoke all on public.cruise_cafe_ocr_extractions_v2 from anon, authenticated;

commit;
