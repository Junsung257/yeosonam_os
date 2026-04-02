-- view_count 증가 함수
CREATE OR REPLACE FUNCTION increment_package_view_count(package_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE travel_packages
  SET view_count = view_count + 1
  WHERE id = package_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- inquiry_count 증가 함수
CREATE OR REPLACE FUNCTION increment_package_inquiry_count(package_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE travel_packages
  SET inquiry_count = inquiry_count + 1
  WHERE id = package_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
