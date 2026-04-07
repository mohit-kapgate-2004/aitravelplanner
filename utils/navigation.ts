import { CommonActions } from "@react-navigation/native";

export const safeGoBack = (navigation: any) => {
  try {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
  } catch (err) {
    // Ignore and continue to fallback
  }

  try {
    if (navigation?.goBack) {
      navigation.goBack();
      return;
    }
  } catch (err) {
    // Ignore and continue to fallback
  }

  const getParents = (nav: any) => {
    const parents = [];
    let current = nav?.getParent?.();
    while (current) {
      parents.push(current);
      current = current.getParent?.();
    }
    return parents;
  };

  const tryNavigate = (nav: any, name: string, params?: any) => {
    if (!nav?.navigate) return false;
    const state = nav?.getState?.();
    if (state?.routeNames && !state.routeNames.includes(name)) return false;
    try {
      nav.navigate(name, params);
      return true;
    } catch (err) {
      return false;
    }
  };

  for (const nav of getParents(navigation)) {
    if (tryNavigate(nav, "Home", { screen: "HomeMain" })) return;
    if (tryNavigate(nav, "HomeMain")) return;
    if (tryNavigate(nav, "Main")) return;
  }

  if (navigation?.navigate) {
    try {
      navigation.navigate("Home", { screen: "HomeMain" });
      return;
    } catch (err) {
      // Ignore navigation errors, fall through
    }
  }

  if (navigation?.navigate) {
    try {
      navigation.navigate("HomeMain");
      return;
    } catch (err) {
      // Ignore navigation errors, fall through
    }
  }

  if (navigation?.navigate) {
    try {
      navigation.navigate("Main");
      return;
    } catch (err) {
      // Ignore navigation errors, fall through
    }
  }

  if (navigation?.reset) {
    navigation.reset({ index: 0, routes: [{ name: "Main" }] });
    return;
  }

  if (navigation?.dispatch) {
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: "Main" }] })
    );
    return;
  }

  navigation?.navigate?.("HomeMain");
};
