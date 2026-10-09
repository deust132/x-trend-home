// 확정 문구(2026-10-09). site.json 값이 null이거나 전환 모드일 때만 쓴다.
// 핸들 후보 @labjang_ai는 계정 생성 전이라 미확정 — 넣지 않는다(링크도 걸지 않는다).
export const DEFAULTS = {
  masthead: { name: '줍줍 데일리', tagline: null },
  operator: { nickname: '랩장', handle: null, bio: null, links: [] },
  bot: { name: '줍줍봇', label: '이 매체의 소식 수집과 초안 작성은 자동 계정 줍줍봇이 돕습니다. 게시 전 검증을 거치며, 편집자 @운영자가 운영합니다.', link: null },
  notices: { ai_image: 'AI로 만든 이미지입니다.', verification: null, newsletter: null },
  pages: {
    about: null,
    policy: '줍줍 데일리는 편집자 @운영자가 운영합니다. 자동 계정 줍줍봇이 소식을 모으고 초안을 씁니다. 실린 사실은 1차 자료로 확인한 것만 싣고, 원문은 옮기지 않고 우리 말로 다시 씁니다. 모든 글은 게시 전 검증을 거치며, 틀린 내용은 정정 기록에 남깁니다.',
    corrections_format: '정정(YYYY-MM-DD): ○○를 ○○로 바로잡습니다. 처음 글은 ○○라고 적었습니다.',
  },
};
// 아직 정해진 문구가 없는 자리(지어내지 않고 임시 표시만 한다)
export const PLACEHOLDER = {
  tagline: '에이전트·자동화와 이미지·영상·디자인, 매일 아침 정리합니다',
  about: 'AI 도구를 실무·창작에 바로 쓰려는 한국어 직장인·1인 창작자를 위한 매체입니다.',
  policy: '편집 방침은 준비 중입니다',
  ai_image: 'AI로 만든 이미지(표시 문구 확정 전)',
};
