import { useNavigate } from "react-router-dom";

export default function Resources() {
  const navigate = useNavigate();
  return (
    <section className="resources-page">
      <div className="packs-page__container">
        <div className="packs-page__header">
          <button className="packs-modal__button packs-modal__button--secondary" onClick={() => navigate(-1)}>
            Back
          </button>
          <h1 className="packs-page__title">Resources</h1>
        </div>
        <p>This is a placeholder for Resources.</p>
      </div>
    </section>
  );
}
