create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  email text not null unique,
  member_id text not null unique,
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists courses (
  id text primary key,
  product_id text not null unique,
  title text not null,
  room text not null,
  subtitle text,
  art_class text,
  video_asset jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists chapters (
  id text primary key,
  course_id text not null references courses(id) on delete cascade,
  label text not null,
  title text not null,
  duration text,
  material text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists imweb_orders (
  order_no text primary key,
  buyer_name text not null,
  buyer_email text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  order_no text not null references imweb_orders(order_no) on delete cascade,
  course_id text not null references courses(id) on delete cascade,
  buyer_email text not null,
  email_verified boolean not null default false,
  contract_signed boolean not null default false,
  status text not null default 'pending_contract' check (status in ('pending_contract', 'active', 'refunded', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_no, course_id)
);

create table if not exists contracts (
  version text primary key,
  title text not null,
  body text not null,
  document_hash text not null,
  required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists contract_signatures (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  enrollment_id uuid references enrollments(id) on delete cascade,
  contract_version text references contracts(version),
  document_hash text not null,
  signed_name text not null,
  signed_email text not null,
  signature_method text not null default 'email_otp_plus_checkbox',
  ip_address inet,
  user_agent text,
  signed_at timestamptz not null default now()
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  order_no text references imweb_orders(order_no) on delete cascade,
  email text not null,
  token_hash text not null unique,
  token_preview text not null,
  status text not null default 'sent' check (status in ('sent', 'used', 'revoked', 'expired')),
  reason text,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists progress (
  profile_id uuid references profiles(id) on delete cascade,
  course_id text references courses(id) on delete cascade,
  chapter_id text references chapters(id) on delete cascade,
  percent integer not null default 0 check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (profile_id, course_id, chapter_id)
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  course_id text references courses(id) on delete cascade,
  chapter_id text references chapters(id) on delete cascade,
  text text not null,
  file_name text,
  status text not null default 'feedback_requested' check (status in ('feedback_requested', 'feedback_sent')),
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  admin_profile_id uuid references profiles(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  label text not null,
  trusted boolean not null default false,
  fingerprint_hash text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (profile_id, fingerprint_hash)
);

create table if not exists playback_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  course_id text references courses(id) on delete cascade,
  chapter_id text references chapters(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  asset_id text not null,
  manifest_url text not null,
  license_url text not null,
  token_hash text not null unique,
  watermark_subject text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);

create table if not exists security_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  type text not null,
  title text not null,
  status text not null check (status in ('allowed', 'blocked', 'ended')),
  detail text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table courses enable row level security;
alter table chapters enable row level security;
alter table imweb_orders enable row level security;
alter table enrollments enable row level security;
alter table contracts enable row level security;
alter table contract_signatures enable row level security;
alter table invitations enable row level security;
alter table progress enable row level security;
alter table assignments enable row level security;
alter table feedback enable row level security;
alter table devices enable row level security;
alter table playback_sessions enable row level security;
alter table security_logs enable row level security;

insert into courses (id, product_id, title, room, subtitle, art_class, video_asset)
values
  (
    'creator-ai',
    'COURSE-AI-01',
    'AI 콘텐츠 제작 마스터',
    '1강의실',
    '기획부터 자동화까지',
    '',
    '{"assetId":"vod-ai-master-001","manifestUrl":"r2://carnival-lion-lms-videos/creator-ai/master.m3u8","packaging":"HLS + signed URL","keySystems":["Signed URL","Dynamic Watermark"]}'::jsonb
  ),
  (
    'design-system',
    'COURSE-DS-02',
    '브랜드 디자인 시스템',
    '2강의실',
    '반복 가능한 디자인 운영',
    'design',
    '{"assetId":"vod-design-system-002","manifestUrl":"r2://carnival-lion-lms-videos/design-system/master.m3u8","packaging":"HLS + signed URL","keySystems":["Signed URL","Dynamic Watermark"]}'::jsonb
  ),
  (
    'feedback-lab',
    'COURSE-FB-03',
    '1:1 피드백 랩',
    '3강의실',
    '과제 중심 실전 코칭',
    'feedback',
    '{"assetId":"vod-feedback-lab-003","manifestUrl":"r2://carnival-lion-lms-videos/feedback-lab/master.m3u8","packaging":"HLS + signed URL","keySystems":["Signed URL","Dynamic Watermark"]}'::jsonb
  )
on conflict (id) do nothing;

insert into chapters (id, course_id, label, title, duration, material, sort_order)
values
  ('ai-01', 'creator-ai', 'Chapter 1', '강의실 세팅과 학습 루틴', '18분', '온보딩 체크리스트.pdf', 1),
  ('ai-02', 'creator-ai', 'Chapter 2', '콘텐츠 기획 프레임 만들기', '27분', '기획 템플릿.xlsx', 2),
  ('ai-03', 'creator-ai', 'Chapter 3', '제작 자동화 워크플로우', '34분', '자동화 플로우.pdf', 3),
  ('ds-01', 'design-system', 'Chapter 1', '브랜드 톤과 UI 원칙', '22분', '브랜드 원칙.pdf', 1),
  ('ds-02', 'design-system', 'Chapter 2', '컴포넌트와 템플릿 정리', '31분', '컴포넌트 보드.fig', 2),
  ('ds-03', 'design-system', 'Chapter 3', '검수 기준과 배포 루틴', '25분', '검수 체크리스트.pdf', 3),
  ('fb-01', 'feedback-lab', 'Chapter 1', '진단 과제 제출', '14분', '진단 과제 안내.pdf', 1),
  ('fb-02', 'feedback-lab', 'Chapter 2', '피드백 반영과 재제출', '20분', '피드백 반영표.docx', 2),
  ('fb-03', 'feedback-lab', 'Chapter 3', '최종 리뷰와 다음 액션', '19분', '최종 리뷰 노트.pdf', 3)
on conflict (id) do nothing;

insert into contracts (version, title, body, document_hash)
values (
  'LMS-CONTRACT-2026.07-A',
  '강의 콘텐츠 보호 및 LMS 이용 동의',
  '계정 대여, 영상 녹화, 다운로드, 재배포를 금지하며 워터마크와 보안 기록 수집에 동의합니다.',
  encode(digest('LMS-CONTRACT-2026.07-A:content-protection:watermark:privacy', 'sha256'), 'hex')
)
on conflict (version) do nothing;
