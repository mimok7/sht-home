'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './Header.css';
export default function Header(){const temporary = usePathname() === '/temp-home'; return <header className="header glass"><div className="container header-content">{temporary ? <div className="logo"><span className="logo-mark">SH</span><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></div> : <Link href="/" className="logo"><span className="logo-mark">SH</span><span>STAY <b>HALONG</b><small>CURATED BAY JOURNEYS</small></span></Link>}</div></header>}
