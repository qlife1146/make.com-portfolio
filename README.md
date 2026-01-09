# make.com-portfolio
## 파일 설명

- `sheet to Figma`: AI에게 말하면 sheet 수정 후 웹훅을 통해 figma에 적용
- `sheet to Figma/make json/make-google to figma.json`: make.com에 import할 json
- `sheet to Figma/n8n json/n8n-google to figma.json`: n8n에 import할 json
- `sheet to Figma/Figma Price.xlxs`: Figma와 연결된 시트 파일(스프레드 시트)

## 실행 구조
make에 json 파일 import 후 active
n8n에 json 파일 import
figma에 플러그인 추가

1. make에서 웹훅을 상시 가동
2. Figma에서 플러그인 실행
1. n8n에서 chat을 통해 요구사항 전송
1. 요구사항대로 AI가 시트 수정
2. Figma에서 실행된 플러그인에 있는 새로고침 클릭하면 시트대로 값 변경
