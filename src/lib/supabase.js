import { platformSupabase } from './platform-supabase';

// 홈페이지의 공개 조회와 고객 인증은 같은 플랫폼 프로젝트를 사용한다.
// 별도 클라이언트를 만들면 브라우저에 두 개의 인증 저장소가 생겨, 헤더와
// 보호된 API 요청이 서로 다른 세션을 읽을 수 있다. 기존 import 호환성을
// 유지하면서도 단일 인증 세션을 보장한다.
export const supabase = platformSupabase;
