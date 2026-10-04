const profileDefaults = { name: 'Carol', gender: 'female', mode: 'friend', flirt: false, adult: false };
let assistantProfile = { ...profileDefaults };
const profileForm = document.querySelector('#profile-form');
if (profileForm) {
  try {
    const saved = JSON.parse(localStorage.getItem('conversa-profile-v1') || 'null');
    if (saved && ['female', 'male'].includes(saved.gender) && ['friend', 'support'].includes(saved.mode)) {
      assistantProfile = { ...profileDefaults, ...saved };
    }
  } catch {}
  profileForm.elements.name.value = assistantProfile.name;
  profileForm.elements.gender.value = assistantProfile.gender;
  profileForm.elements.mode.value = assistantProfile.mode;
  profileForm.elements.flirt.checked = assistantProfile.flirt;
  profileForm.elements.adult.checked = assistantProfile.adult;
  const synchronize = () => {
    const support = profileForm.elements.mode.value === 'support';
    profileForm.elements.flirt.disabled = support;
    if (support) profileForm.elements.flirt.checked = false;
  };
  profileForm.elements.mode.addEventListener('change', synchronize);
  synchronize();
  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = profileForm.elements.name.value.trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{M} '-]{1,30}$/u.test(name)) {
      profileForm.elements.name.setCustomValidity('Use um nome de até 30 caracteres, com letras e espaços.');
      profileForm.elements.name.reportValidity();
      return;
    }
    assistantProfile = { name, gender: profileForm.elements.gender.value, mode: profileForm.elements.mode.value,
      flirt: profileForm.elements.flirt.checked, adult: profileForm.elements.adult.checked };
    try { localStorage.setItem('conversa-profile-v1', JSON.stringify(assistantProfile)); } catch {}
    profileForm.hidden = true;
    document.querySelector('#conversation').hidden = false;
    document.querySelector('#companion-label').textContent = name + ' está com você';
    document.querySelector('#status').textContent = name + ' está pronto para conversar';
    const orb = document.querySelector('#orb');
    orb.classList.toggle('male-profile', assistantProfile.gender === 'male');
    document.querySelector('#profile-initial').textContent = name[0].toUpperCase();
  });
  profileForm.elements.name.addEventListener('input', () => profileForm.elements.name.setCustomValidity(''));
  document.querySelector('#edit-profile').addEventListener('click', () => {
    stopConversation();
    document.querySelector('#conversation').hidden = true;
    profileForm.hidden = false;
  });
}
