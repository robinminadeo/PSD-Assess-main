import { useEffect, useState } from 'react';
import questionMarkdown from '../psd.md?raw';
import { getQuestionPriorities, saveQuestionResult } from './services/questionResults';

const questionBank = questionMarkdown
  .split(/^###\s+/m)
  .slice(1)
  .map((block, index) => {
    const [rawTitle, ...body] = block.split('\n');
    const options = body.join('\n').matchAll(/^- \[([ x])\] (.+)$/gm);
    const answers = Array.from(options, ([, checked, text]) => ({
      text: text.replace(/\*\*/g, '').trim(),
      correct: checked === 'x',
    }));
    return {
      id: index + 1,
      title: rawTitle.trim(),
      answers,
      correct: answers.flatMap((answer, answerIndex) => answer.correct ? [answerIndex] : []),
    };
  })
  .filter((question) => question.title && question.answers.length && question.correct.length);

const modes = [
  { id: 'practice', number: '01', title: 'One at a time', detail: 'A fresh random question, instant feedback, no pressure.', meta: '∞ QUESTIONS' },
  { id: 'quick', number: '02', title: 'Quick test', detail: '30 random questions. Submit when you’re ready.', meta: '30 QUESTIONS · UNTIL SUBMIT' },
  { id: 'exam', number: '03', title: 'Assessment exam', detail: '80 questions. 60 minutes. 85% to pass.', meta: '80 QUESTIONS · 60 MINUTES' },
];

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function chooseWeighted(items, priorities) {
  const tier = (question) => {
    const priority = priorities[question.id];
    if (!priority || priority.attempts === 0) return 0;
    return priority.failures > 0 ? 1 : 2;
  };
  const highestPriorityTier = Math.min(...items.map(tier));
  const eligible = items.filter((question) => tier(question) === highestPriorityTier);
  const weights = eligible.map((question) => 1 + (priorities[question.id]?.failurePercent || 0) / 10);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = Math.random() * totalWeight;
  for (let index = 0; index < eligible.length; index += 1) {
    target -= weights[index];
    if (target < 0) return eligible[index];
  }
  return eligible.at(-1);
}

function prioritizeQuestions(items, priorities, count) {
  const remaining = [...items];
  const selected = [];
  while (remaining.length && selected.length < count) {
    const question = chooseWeighted(remaining, priorities);
    selected.push(question);
    remaining.splice(remaining.indexOf(question), 1);
  }
  return selected;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function App() {
  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [practiceQuestion, setPracticeQuestion] = useState(null);
  const [practiceSelection, setPracticeSelection] = useState([]);
  const [practiceChecked, setPracticeChecked] = useState(false);
  const [result, setResult] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(3600);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [priorityScores, setPriorityScores] = useState({});
  const currentQuestionId = session?.mode === 'practice'
    ? practiceQuestion?.id
    : session?.mode === 'quick'
      ? session.questions[activeQuestion]?.id
      : undefined;

  useEffect(() => {
    if (session?.mode !== 'exam' || result) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((remaining) => {
        if (remaining <= 1) {
          window.clearInterval(timer);
          setResult({ answers, questions: session.questions, mode: session.mode, timedOut: true });
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session, result, answers]);

  useEffect(() => {
    if (!currentQuestionId) return undefined;
    let current = true;
    getQuestionPriorities().then((priorities) => {
      if (current) setPriorityScores(priorities);
    });
    return () => {
      current = false;
    };
  }, [currentQuestionId]);

  async function startMode(mode) {
    const priorities = mode === 'exam' ? {} : await getQuestionPriorities();
    setPriorityScores(priorities);
    if (mode === 'practice') {
      setSession({ mode });
      setPracticeQuestion(chooseWeighted(questionBank, priorities));
      setPracticeSelection([]);
      setPracticeChecked(false);
      return;
    }
    const count = mode === 'quick' ? 30 : 80;
    const selectedQuestions = mode === 'quick'
      ? prioritizeQuestions(questionBank, priorities, count)
      : shuffled(questionBank).slice(0, count);
    setSession({ mode, questions: selectedQuestions });
    setAnswers({});
    setActiveQuestion(0);
    setResult(null);
    setSecondsLeft(3600);
  }

  function nextPracticeQuestion() {
    const candidates = questionBank.filter((question) => question.id !== practiceQuestion?.id);
    setPracticeQuestion(chooseWeighted(candidates, priorityScores));
    setPracticeSelection([]);
    setPracticeChecked(false);
  }

  function checkPracticeAnswer() {
    setPracticeChecked(true);
    const correct = practiceQuestion.correct.length === practiceSelection.length
      && practiceQuestion.correct.every((answer) => practiceSelection.includes(answer));
    saveQuestionResult({ questionId: practiceQuestion.id, mode: 'practice', correct }).then(async (saved) => {
      if (saved) setPriorityScores(await getQuestionPriorities());
    });
  }

  function goHome() {
    setSession(null);
    setResult(null);
    setPracticeQuestion(null);
  }

  function toggleAnswer(questionId, answerIndex, multiple) {
    setAnswers((current) => {
      const selected = current[questionId] || [];
      const next = multiple
        ? selected.includes(answerIndex) ? selected.filter((item) => item !== answerIndex) : [...selected, answerIndex]
        : [answerIndex];
      return { ...current, [questionId]: next };
    });
  }

  function submitTest() {
    setResult({ answers, questions: session.questions, mode: session.mode, timedOut: false });
    if (session.mode === 'quick') {
      Promise.all(session.questions.map((question) => {
        const selected = answers[question.id] || [];
        const correct = selected.length === question.correct.length
          && question.correct.every((answer) => selected.includes(answer));
        return saveQuestionResult({ questionId: question.id, mode: 'quick', correct });
      })).then(async (saved) => {
        if (saved.some(Boolean)) setPriorityScores(await getQuestionPriorities());
      });
    }
  }

  if (!session) {
    return (
      <main className="shell">
        <header className="topbar">
          <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); goHome(); }}>
            <span className="brand-mark">P</span><span>Practice Room</span>
          </a>
          <span className="topbar-note">SCRUM. SOFTWARE. SELF-PACED.</span>
        </header>
        <section className="hero" id="home">
          <div className="hero-copy">
            <p className="eyebrow"><span className="live-dot" /> PSD ASSESSMENT PREP</p>
            <h1>Know your<br /><span>Scrum.</span></h1>
            <p className="intro">A quieter way to get exam-ready. Work through real practice questions, find your gaps, and build confidence one answer at a time.</p>
            <div className="bank-note"><span className="bank-count">{questionBank.length}</span><span>questions in your<br />practice bank</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="art-card"><span className="art-index">FIELD NOTES · 01</span><span className="art-check">✓</span><span className="art-label">inspect<br />& adapt</span><span className="art-line" /></div>
            <span className="art-star">✳</span><span className="art-caption">LEARN BY DOING</span>
          </div>
        </section>
        <section className="mode-section">
          <div className="section-heading"><div><p className="eyebrow">PICK YOUR PACE</p><h2>Choose a session</h2></div><span className="section-count">03 MODES</span></div>
          <div className="mode-list">
            {modes.map((mode) => (
              <button className={`mode-row mode-${mode.id}`} key={mode.id} onClick={() => startMode(mode.id)}>
                <span className="mode-number">{mode.number}</span>
                <span className="mode-main"><span className="mode-title">{mode.title}</span><span className="mode-detail">{mode.detail}</span></span>
                <span className="mode-meta">{mode.meta}</span>
                <span className="mode-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </section>
        <footer className="page-footer"><span>BUILT FOR THE NEXT GOOD QUESTION.</span><span>PSD PRACTICE ROOM <span className="footer-dot">●</span></span></footer>
      </main>
    );
  }

  if (session.mode === 'practice') {
    return (
      <main className="test-shell">
        <TestHeader onHome={goHome} label="ONE AT A TIME" />
        <section className="practice-wrap">
          <p className="eyebrow"><span className="live-dot" /> RANDOM QUESTION <span className="separator">/</span> #{practiceQuestion?.id}</p>
          <QuestionCard
            question={practiceQuestion}
            selected={practiceSelection}
            failurePercent={practiceQuestion ? priorityScores[practiceQuestion.id]?.failurePercent ?? 0 : undefined}
            onSelect={(index, multiple) => {
              setPracticeSelection((current) => multiple
                ? current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
                : [index]);
            }}
            checked={practiceChecked}
          />
          {practiceChecked && <Feedback question={practiceQuestion} selected={practiceSelection} />}
          <div className="practice-actions">
            {!practiceChecked
              ? <button className="primary-button" disabled={!practiceSelection.length} onClick={checkPracticeAnswer}>Check answer <span>↗</span></button>
              : <button className="primary-button" onClick={nextPracticeQuestion}>Next random question <span>↗</span></button>}
            <span className="practice-hint">{practiceChecked ? 'Your next question will be different.' : 'Take your time. Select all that apply.'}</span>
          </div>
        </section>
      </main>
    );
  }

  if (result) return <Results result={result} onHome={goHome} onRetry={() => startMode(result.mode)} />;

  const questions = session.questions;
  const question = questions[activeQuestion];
  const answeredCount = Object.values(answers).filter((selection) => selection.length).length;
  const progress = Math.round((answeredCount / questions.length) * 100);

  return (
    <main className="test-shell">
      <TestHeader onHome={goHome} label={session.mode === 'exam' ? 'ASSESSMENT EXAM' : 'QUICK TEST'}>
        {session.mode === 'exam' && <span className={`timer ${secondsLeft < 300 ? 'timer-low' : ''}`}>◷ {formatTime(secondsLeft)}</span>}
      </TestHeader>
      <div className="test-layout">
        <section className="question-column">
          <div className="test-progress"><span>QUESTION <strong>{String(activeQuestion + 1).padStart(2, '0')}</strong> <span className="muted">/ {questions.length}</span></span><span>{answeredCount} ANSWERED</span></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <QuestionCard
            key={question.id}
            question={question}
            selected={answers[question.id] || []}
            failurePercent={priorityScores[question.id]?.failurePercent ?? 0}
            onSelect={(index, multiple) => toggleAnswer(question.id, index, multiple)}
          />
          <div className="question-nav">
            <button className="text-button" disabled={activeQuestion === 0} onClick={() => setActiveQuestion((current) => current - 1)}>← Previous</button>
            {activeQuestion < questions.length - 1
              ? <button className="primary-button" onClick={() => setActiveQuestion((current) => current + 1)}>Next question <span>→</span></button>
              : <button className="primary-button" onClick={submitTest}>Submit test <span>↗</span></button>}
          </div>
        </section>
        <aside className="question-map">
          <div className="map-heading"><span>QUESTION MAP</span><span>{answeredCount}/{questions.length}</span></div>
          <div className="map-grid">{questions.map((item, index) => <button key={item.id} aria-label={`Go to question ${index + 1}`} aria-current={activeQuestion === index ? 'step' : undefined} className={`${activeQuestion === index ? 'current' : ''} ${(answers[item.id] || []).length ? 'answered' : ''}`} onClick={() => setActiveQuestion(index)}>{index + 1}</button>)}</div>
          <div className="map-legend"><span><i className="legend-current" /> Current</span><span><i className="legend-answered" /> Answered</span></div>
          <button className="submit-link" onClick={submitTest}>Finish and submit <span>↗</span></button>
        </aside>
      </div>
    </main>
  );
}

function TestHeader({ onHome, label, children }) {
  return <header className="topbar test-topbar"><a className="brand" href="#home" onClick={(event) => { event.preventDefault(); onHome(); }}><span className="brand-mark">P</span><span>Practice Room</span></a><span className="session-label">{label}</span>{children || <button className="exit-button" onClick={onHome}>Exit session <span>×</span></button>}</header>;
}

function QuestionCard({ question, selected, onSelect, checked = false, failurePercent }) {
  if (!question) return null;
  const multiple = question.correct.length > 1;
  const failureText = Number.isFinite(failurePercent) ? `${Math.round(failurePercent)}%` : 'No data';
  return <article className="question-card">
    <div className="question-kicker">
      <span>QUESTION {String(question.id).padStart(3, '0')}</span>
      <span>{multiple ? 'SELECT ALL THAT APPLY' : 'SELECT ONE'}</span>
      <span className="question-failure-rate"><span className="question-failure-dot" /> FAILURE RATE: <strong>{failureText}</strong></span>
    </div>
    <h1>{question.title}</h1>
    <div className="answer-list">
      {question.answers.map((answer, index) => {
        const isSelected = selected.includes(index);
        const stateClass = checked ? answer.correct ? 'is-correct' : isSelected ? 'is-wrong' : '' : isSelected ? 'is-selected' : '';
        return <button key={`${question.id}-${index}`} className={`answer-option ${stateClass}`} onClick={() => !checked && onSelect(index, multiple)} disabled={checked}>
          <span className={`answer-marker ${multiple ? 'checkbox-marker' : ''}`}>{checked && answer.correct ? '✓' : isSelected && checked ? '×' : multiple ? '' : String.fromCharCode(65 + index)}</span>
          <span>{answer.text}</span>
          {checked && answer.correct && <span className="answer-status">CORRECT</span>}
          {checked && isSelected && !answer.correct && <span className="answer-status">YOUR PICK</span>}
        </button>;
      })}
    </div>
  </article>;
}

function Feedback({ question, selected }) {
  const correct = question.correct.length === selected.length && question.correct.every((answer) => selected.includes(answer));
  return <div className={`feedback ${correct ? 'feedback-correct' : 'feedback-wrong'}`}><span>{correct ? '✓' : '!'}</span><div><strong>{correct ? 'That’s right.' : 'Not quite.'}</strong><p>{correct ? 'You selected the complete correct answer.' : 'Review the highlighted answer, then carry that learning into the next question.'}</p></div></div>;
}

function Results({ result, onHome, onRetry }) {
  const correctCount = result.questions.filter((question) => {
    const selected = result.answers[question.id] || [];
    return selected.length === question.correct.length && question.correct.every((answer) => selected.includes(answer));
  }).length;
  const incorrectCount = result.questions.length - correctCount;
  const percent = Math.round((correctCount / result.questions.length) * 100);
  const passed = result.mode !== 'exam' || percent >= 85;
  return <main className="test-shell results-shell">
    <TestHeader onHome={onHome} label="SESSION RESULTS" />
    <section className="results-wrap">
      <p className="eyebrow"><span className={`result-dot ${passed ? '' : 'result-dot-fail'}`} /> {result.timedOut ? 'TIME EXPIRED' : 'SESSION COMPLETE'}</p>
      <h1>{result.mode === 'exam' ? passed ? 'Assessment passed.' : 'Keep building.' : 'A good session.'}</h1>
      <p className="results-intro">{result.mode === 'exam' ? passed ? 'You reached the 85% passing score. Nicely done.' : 'The passing score is 85%. Review the questions below and give it another go.' : 'Here’s how your answers stacked up.'}</p>
      <div className="score-panel"><div className="score-main"><span className="score-number">{percent}<small>%</small></span><span className="score-label">OVERALL SCORE</span></div><div className="score-stat"><strong>{correctCount}</strong><span>CORRECT</span></div><div className="score-stat"><strong>{incorrectCount}</strong><span>INCORRECT</span></div><div className="score-stat"><strong>{result.questions.length}</strong><span>TOTAL</span></div></div>
      <div className="results-actions"><button className="primary-button" onClick={onRetry}>Try another session <span>↗</span></button><button className="text-button" onClick={onHome}>Back to home</button></div>
      <details className="review-list"><summary>Review answers <span>{incorrectCount} to revisit</span></summary><div>{result.questions.map((question, index) => {
        const selected = result.answers[question.id] || [];
        const isCorrect = selected.length === question.correct.length && question.correct.every((answer) => selected.includes(answer));
        return <div className="review-item" key={question.id}><span className={isCorrect ? 'review-check' : 'review-cross'}>{isCorrect ? '✓' : '×'}</span><div><strong>{index + 1}. {question.title}</strong><p>{selected.length ? `Your answer: ${selected.map((answer) => question.answers[answer].text).join('; ')}` : 'Not answered'}{!isCorrect && ` · Correct: ${question.correct.map((answer) => question.answers[answer].text).join('; ')}`}</p></div></div>;
      })}</div></details>
    </section>
  </main>;
}

export default App;