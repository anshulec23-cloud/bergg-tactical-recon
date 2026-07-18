import React, { useEffect, useState } from 'react';
import './LandingPage.css';

export default function LandingPage({ onEnter }) {
  const [clicked, setClicked] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({
        x: e.clientX,
        y: e.clientY
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleClick = () => {
    if (clicked) return;
    setClicked(true);
    // Wait for fade out animation
    setTimeout(() => {
      onEnter();
    }, 1500);
  };

  return (
    <div 
      className={`bergg-landing ${clicked ? 'exiting' : ''}`} 
      onClick={handleClick}
    >
      <div 
        className="bergg-landing-ambient"
        style={{
          background: `radial-gradient(circle at ${mousePos.x}px ${mousePos.y}px, rgba(51, 170, 255, 0.1) 0%, transparent 40%)`
        }}
      ></div>
      
      <div className="bergg-landing-particles">
        {/* We can use simple CSS animations for particles */}
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
        <div className="particle"></div>
      </div>
      
      <div className="bergg-landing-content">
        <h1 className="bergg-landing-title">
          <span className="title-letter">B</span>
          <span className="title-letter">E</span>
          <span className="title-letter">R</span>
          <span className="title-letter">G</span>
          <span className="title-letter">G</span>
        </h1>
        
        <div className="bergg-landing-divider"></div>
        
        <h2 className="bergg-landing-user">Welcome, Anshul</h2>
        
        <p className="bergg-landing-subtitle">Tactical Reconnaissance System</p>
        
        <button className="bergg-enter-btn">
          <span>INITIALIZE</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
