'use client';

import { useEffect, useMemo, useState } from 'react';
import './CruiseMediaGallery.css';

function uniqueImages(images) {
  const seen = new Set();
  return (images || []).filter((image) => {
    if (!image?.url || seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

export default function CruiseMediaGallery({
  cruiseName,
  category,
  duration,
  heroImage,
  displayImage,
  groups = [],
  showMain = true,
  showArchive = true,
  mainGroupId = 'main',
  mainClassName = '',
  showMainMeta = true,
}) {
  const normalizedGroups = useMemo(() => {
    const nextGroups = groups
      .map((group) => ({ ...group, images: uniqueImages(group.images) }))
      .filter((group) => group.images.length > 0);
    const mainIndex = nextGroups.findIndex((group) => group.id === 'main');
    const fallbackMain = { id: 'main', label: '대표 이미지', eyebrow: 'CRUISE', images: [{ id: 'hero', url: heroImage, alt: `${cruiseName} 대표 이미지` }] };
    if (mainIndex < 0) return [fallbackMain, ...nextGroups];
    nextGroups[mainIndex] = { ...nextGroups[mainIndex], images: uniqueImages([...nextGroups[mainIndex].images, ...fallbackMain.images]) };
    return nextGroups;
  }, [cruiseName, groups, heroImage]);
  const mainGroup = normalizedGroups.find((group) => group.id === mainGroupId)
    || normalizedGroups.find((group) => group.id === 'main')
    || normalizedGroups[0];
  const secondaryGroups = normalizedGroups.filter((group) => group.id !== mainGroup?.id);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const activeGroup = normalizedGroups.find((group) => group.id === activeGroupId) || null;
  const activeImage = activeGroup?.images[activeIndex] || null;

  useEffect(() => {
    if (!activeGroup) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActiveGroupId('');
      if (event.key === 'ArrowLeft') setActiveIndex((current) => (current - 1 + activeGroup.images.length) % activeGroup.images.length);
      if (event.key === 'ArrowRight') setActiveIndex((current) => (current + 1) % activeGroup.images.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeGroup]);

  function openGroup(groupId) {
    setActiveGroupId(groupId);
    setActiveIndex(0);
  }

  function closeGallery() {
    setActiveGroupId('');
    setActiveIndex(0);
  }

  return (
    <>
      {showMain && mainGroup?.images[0] && (
        <button
          type="button"
          className={`product-image-box product-image-button ${mainClassName}`.trim()}
          style={{ backgroundImage: `url(${displayImage || mainGroup.images[0].url})` }}
          onClick={(event) => {
            event.stopPropagation();
            openGroup(mainGroup.id);
          }}
          aria-label={`${cruiseName} ${mainGroup.label} 이미지 크게 보기`}
        >
          {showMainMeta && <>
            <span className="badge">{category || 'CURATED'}</span>
            <span className="duration-tag">{duration || '일정 확인'}</span>
            <span className="image-open-hint">크게 보기 <b>↗</b></span>
            {mainGroup.images.length > 1 && <span className="image-count">{mainGroup.images.length} IMAGES</span>}
          </>}
        </button>
      )}

      {showArchive && secondaryGroups.length > 0 && (
        <section className="cruise-media-groups" aria-label={`${cruiseName} 저장 이미지`}>
          <div className="cruise-media-heading"><span>PHOTO ARCHIVE</span><small>대표 사진을 누르면 같은 분류의 전체 원본을 볼 수 있습니다.</small></div>
          <div className="cruise-media-strip">
            {secondaryGroups.map((group) => (
              <button type="button" className="cruise-media-group" key={group.id} onClick={() => openGroup(group.id)}>
                <span className="cruise-media-thumb" style={{ backgroundImage: `url(${group.images[0].url})` }} />
                <span className="cruise-media-copy"><small>{group.eyebrow}</small><strong>{group.label}</strong><i>{group.images.length}장 전체 보기 ↗</i></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeGroup && activeImage && (
        <div className="cruise-lightbox" role="dialog" aria-modal="true" aria-label={`${cruiseName} ${activeGroup.label} 이미지`} onClick={(event) => { if (event.target === event.currentTarget) closeGallery(); }}>
          <div className="cruise-lightbox-panel">
            <header>
              <div><span>{activeGroup.eyebrow} / {String(activeIndex + 1).padStart(2, '0')}</span><strong>{cruiseName} · {activeGroup.label}</strong></div>
              <button type="button" onClick={closeGallery} aria-label="이미지 갤러리 닫기">닫기 ×</button>
            </header>
            <div className="cruise-lightbox-stage">
              <div className="cruise-lightbox-image" role="img" aria-label={activeImage.alt} style={{ backgroundImage: `url(${activeImage.url})` }} />
              {activeGroup.images.length > 1 && (
                <>
                  <button type="button" className="lightbox-nav prev" aria-label="이전 이미지" onClick={() => setActiveIndex((activeIndex - 1 + activeGroup.images.length) % activeGroup.images.length)}>←</button>
                  <button type="button" className="lightbox-nav next" aria-label="다음 이미지" onClick={() => setActiveIndex((activeIndex + 1) % activeGroup.images.length)}>→</button>
                </>
              )}
            </div>
            <footer>
              <div className="lightbox-thumbnails" aria-label={`${activeGroup.label} 전체 이미지`}>
                {activeGroup.images.map((image, index) => (
                  <button type="button" key={image.id || image.url} className={index === activeIndex ? 'selected' : ''} style={{ backgroundImage: `url(${image.url})` }} onClick={() => setActiveIndex(index)} aria-label={`${index + 1}번 이미지 보기`} aria-current={index === activeIndex ? 'true' : undefined} />
                ))}
              </div>
              <p><strong>{activeIndex + 1} / {activeGroup.images.length}</strong><span>{activeImage.alt}</span></p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
