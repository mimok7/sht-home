'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import './Header.css';
export default function Header(){const temporary = usePathname() === '/temp-home'; return <header className="header glass"><div className="container header-content">{temporary ? <div className="logo"><Image className="logo-mark" src="/images/cruises/logo2.png" alt="SH" width={187} height={183} /><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></div> : <Link href="/" className="logo"><Image className="logo-mark" src="/images/cruises/logo2.png" alt="SH" width={187} height={183} /><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></Link>}</div></header>}
