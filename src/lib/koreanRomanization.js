const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINAL = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];
const ENGLISH_ROOM_TERMS = [
  ['호안끼엠-선착장 셔틀리무진', 'Hoan Kiem Pier Shuttle Limousine'], ['크루즈 티켓', 'Cruise Ticket'],
  ['이동차량 제외', 'Transfer Vehicle Excluded'], ['차량 포함', 'Vehicle Included'], ['셔틀리무진', 'Shuttle Limousine'],
  ['반마리', 'Half Lobster'], ['1인당', 'Per Person'], ['왕복', 'Round Trip'], ['편도', 'One Way'],
  ['패밀리 커넥팅 발코니 스위트', 'Family Connecting Balcony Suite'],
  ['프라이빗 디럭스룸', 'Private Deluxe Room'], ['프라이빗 프리미엄룸', 'Private Premium Room'],
  ['스카이 테라스 패밀리 스위트', 'Sky Terrace Family Suite'], ['스카이 패밀리 스위트', 'Sky Family Suite'],
  ['프리미엄 발코니 오션뷰', 'Premium Balcony Ocean View'], ['디럭스 발코니 오션뷰', 'Deluxe Balcony Ocean View'],
  ['이그제큐티브 테라스 스위트', 'Executive Terrace Suite'], ['이그제큐티브 발코니 스위트', 'Executive Balcony Suite'],
  ['이그제큐티브 스위트룸', 'Executive Suite'], ['이그제큐티브 스위트', 'Executive Suite'], ['이그제큐티브 발코니', 'Executive Balcony'],
  ['프레지던트 스위트', 'President Suite'], ['프레지던트룸', 'President Room'], ['프리미엄 이그제큐티브', 'Premium Executive'],
  ['프리미어 발코니', 'Premier Balcony'], ['디럭스 발코니', 'Deluxe Balcony'], ['엘리트 발코니 스위트', 'Elite Balcony Suite'],
  ['시니어 발코니 스위트', 'Senior Balcony Suite'], ['시니어 발코니', 'Senior Balcony'], ['주니어 오션 스위트', 'Junior Ocean Suite'],
  ['주니어 발코니', 'Junior Balcony'], ['트리플 발코니', 'Triple Balcony'], ['커넥팅 발코니', 'Connecting Balcony'],
  ['발코니 스위트', 'Balcony Suite'], ['패밀리 그랜드 스위트', 'Family Grand Suite'], ['패밀리 스위트', 'Family Suite'],
  ['VIP 허니문 스위트', 'VIP Honeymoon Suite'], ['VIP 오션 스위트', 'VIP Ocean Suite'], ['캡틴스위트', 'Captain Suite'],
  ['캡틴 뷰 스위트', 'Captain View Suite'], ['캡틴 스위트', 'Captain Suite'], ['스위트룸', 'Suite'],
  ['이그제큐티브 트리플', 'Executive Triple'], ['스카이', 'Sky'], ['테라스', 'Terrace'], ['패밀리', 'Family'],
  ['시니어', 'Senior'], ['아테나', 'Athena'], ['엘리트', 'Elite'], ['엠바사더', 'Ambassador'], ['오아시스', 'Oasis'],
  ['이그제큐티브', 'Executive'], ['주니어', 'Junior'], ['캡틴', 'Captain'], ['커넥팅', 'Connecting'], ['트리플', 'Triple'],
  ['프라이빗', 'Private'], ['프레지던트', 'President'], ['프리미어', 'Premier'], ['프리미엄', 'Premium'],
  ['디럭스룸', 'Deluxe Room'], ['프리미엄룸', 'Premium Room'], ['디럭스', 'Deluxe'], ['발코니', 'Balcony'],
  ['오션뷰', 'Ocean View'], ['오션', 'Ocean'], ['스위트', 'Suite'], ['갤러리', 'Gallery'], ['그랜드', 'Grand'],
  ['란하', 'Lan Ha'], ['레거시', 'Legacy'], ['로얄', 'Royal'], ['하롱', 'Halong'], ['하모니', 'Harmony'], ['할로라', 'Halora'],
  ['빌라', 'Villa'], ['호안끼엠', 'Hoan Kiem'], ['선착장', 'Pier'], ['리무진', 'Limousine'], ['셔틀', 'Shuttle'],
  ['크루즈', 'Cruise'], ['레스토랑', 'Restaurant'], ['랍스터', 'Lobster'], ['옵션', 'Option'], ['성인', 'Adult'],
  ['차량', 'Vehicle'], ['포함', 'Included'], ['제외', 'Excluded'], ['층', 'Floor'], ['룸', 'Room'],
];

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : '';
}

// Korean room names only need a stable Latin filename/display fallback; the original Korean name remains untouched.
export function romanizeKoreanName(value) {
  const syllables = [];
  let current = '';
  const flush = () => {
    if (current) syllables.push(capitalize(current));
    current = '';
  };

  let source = String(value || '').trim().normalize('NFC');
  for (const [korean, english] of ENGLISH_ROOM_TERMS) source = source.replaceAll(korean, ` ${english} `);

  for (const character of source) {
    const code = character.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code < 11172) {
      const initial = Math.floor(code / 588);
      const medial = Math.floor((code % 588) / 28);
      const final = code % 28;
      current += `${INITIAL[initial]}${MEDIAL[medial]}${FINAL[final]}`;
      continue;
    }
    if (/[a-z0-9]/i.test(character)) {
      current += character;
      continue;
    }
    flush();
  }
  flush();
  return syllables.join(' ');
}
