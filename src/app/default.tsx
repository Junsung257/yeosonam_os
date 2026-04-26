// Next.js 14 dev 모드에서 parallel route slot 매칭 누락 시 NotFound boundary로 떨어지며
// "No default component was found for a parallel route" 경고가 발생한다.
// 우리는 명시적 parallel route(`@slot/`)를 쓰지 않지만, 이 default.tsx 한 줄이 그 false-positive를
// 잠재워 dev 콘솔 노이즈를 제거한다. 빌드 결과물 영향 없음.
export default function DefaultRoot() {
  return null;
}
