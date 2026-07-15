import SupportPage from '../../components/SupportPage';
import styles from '../../components/SupportPage.module.css';
export const metadata = { title: '공지사항 | STAY HALONG' };
const notices = [['2026. 07. 15','하롱베이 현지 상담 운영시간 변경 안내','매일 09:00 - 23:00 카카오톡으로 상담해드립니다.'],['2026. 07. 01','여름 성수기 크루즈 예약 안내','성수기 일정은 조기 마감될 수 있어 원하는 날짜를 미리 알려주세요.'],['2026. 06. 20','스테이하롱 홈페이지를 오픈했습니다','현지에서 직접 확인한 하롱베이 크루즈를 한곳에서 만나보세요.']];
export default function NoticePage() { return <SupportPage eyebrow="STAY HALONG / NEWS" title={<>공지사항<span>.</span></>} intro="여행 전 알아두면 좋은 소식과 예약 관련 안내를 전해드립니다."><section>{notices.map(([date,title,text],i)=><article key={title} className={styles.noticeRow}><span>{String(i+1).padStart(2,'0')}</span><div><time>{date}</time><h2>{title}</h2><p>{text}</p></div><b>↗</b></article>)}</section></SupportPage>; }
