// Textes français du service worker : entrées de menu et autres (clés 'menu.*', 'sw.*').
/** @type {Record<string, string>} */
export default {
  'sw.actionTitle': 'Obturo', // infobulle de l'icône ; le même texte que "actionTitle" dans _locales/fr/messages.json
  'menu.capture': 'Capturer',
  'menu.captureEdit': 'Capturer et éditer',
  'menu.area': 'Zone',
  'menu.visible': 'Partie visible',
  'menu.full': 'Page entière',
  'menu.element': 'Élément',
  'menu.library': 'Ouvrir la bibliothèque',
  'menu.settings': 'Paramètres',
  // le mode sans trace : une capture est copiée et n'est enregistrée nulle part
  'sw.noTrace.title': 'sans trace', // après le nom dans l'infobulle de l'icône, tant que le mode est actif
  'sw.noTrace.edit': "Le mode sans trace est actif\u00a0: rien n'est enregistré, il n'y a donc rien à éditer. Désactive-le dans la fenêtre de l'icône Obturo pour éditer une capture.",
  'sw.noTrace.copyFailed': "Sans trace\u00a0: la copie a échoué et rien n'a été enregistré. Réessaie.",
  'sw.copied': "Capture copiée et enregistrée dans l'historique.",
  'sw.copied.noTrace': "Capture copiée. Rien n'a été enregistré (sans trace).",
  'sw.copyFailed': "La copie a échoué. La capture est dans l'historique : copie-la depuis là.",
  // ce qu'une capture de page entière dit à l'utilisateur sur la page (notice.js) : ce que l'image n'est pas, ou pourquoi la capture s'est arrêtée
  'sw.full.cut': "La page est plus longue que ce qu'une capture peut contenir\u00a0: l'image s'arrête au point atteint.",
  'sw.full.scaled': "L'image a été réduite à {n}\u00a0% pour tenir dans les limites d'une capture.",
  'sw.full.frame': "Le contenu est dans un cadre qu'Obturo ne peut pas faire défiler\u00a0: seule la partie visible a été capturée.",
  'sw.full.fail.resized': "Page entière interrompue\u00a0: la fenêtre a changé de taille pendant la capture. Rien n'a été enregistré. Réessaie sans toucher à la fenêtre.",
  'sw.full.fail.moved': "Page entière interrompue\u00a0: la zone capturée a bougé pendant le défilement. Rien n'a été enregistré.",
  'sw.full.fail.tab': "Page entière interrompue\u00a0: un autre onglet ou une autre fenêtre a pris le premier plan pendant la capture. Rien n'a été enregistré.",
  'sw.full.fail.page': "Page entière interrompue\u00a0: la page a changé ou ne répondait plus pendant la capture. Rien n'a été enregistré.",
  'sw.full.fail.other': "La page entière a échoué. Rien n'a été enregistré. Réessaie.",
  // what a capture says on the page when the sensitive text was hidden (redact.js)
  'sw.redact.one': "{n} élément sensible recouvert dans le texte de la page. Les champs de formulaire, les images et les cadres ne sont pas recouverts : vérifie l'image avant de partager.",
  'sw.redact.other': "{n} éléments sensibles recouverts dans le texte de la page. Les champs de formulaire, les images et les cadres ne sont pas recouverts : vérifie l'image avant de partager.",
  'sw.redact.none': "Aucune adresse e-mail, aucun numéro de téléphone, IBAN, numéro de carte ni clé trouvé dans le texte de la page. Les champs de formulaire, les images et les cadres ne sont pas recouverts : vérifie l'image avant de partager.",
  'sw.redact.partial': 'La page est trop grande pour être parcourue en entier : du texte peut rester visible.',
};
